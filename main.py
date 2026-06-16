import os
import time
from datetime import datetime, timedelta
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/fitness.body.read"]


def main():
    creds = get_credentials()
    fitness_service = build("fitness", "v1", credentials=creds)
    time_range = get_time_range()
    weight_history = get_weight_history(fitness_service, time_range)
    print(weight_history)
    average = get_average(weight_history)
    print(f"Average weight: {average:.1f}")


def get_credentials():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                "./credentials.json", SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open("token.json", "w") as token:
            token.write(creds.to_json())
    print("Successfully authenticated")
    return creds


def get_time_range():
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    if today.weekday() == 6:
        print(f"Original day: {today}")
        today = today - timedelta(days=1)
        print(f"Adjusted (it was Sunday): {today}")
    days_to_last_sunday = today.weekday() + 1
    last_sunday = today - timedelta(days=days_to_last_sunday)
    start_ns = int(last_sunday.timestamp() * 1000000000)
    end_ns = int(time.time() * 1000000000)
    return start_ns, end_ns


def get_weight_history(fitness_service, time_range):
    weights = []
    data_source = "derived:com.google.weight:com.google.android.gms:merge_weight"
    dataset_id = f"{time_range[0]}-{time_range[1]}"

    response = (
        fitness_service.users()
        .dataSources()
        .datasets()
        .get(userId="me", dataSourceId=data_source, datasetId=dataset_id)
        .execute()
    )

    points = response.get("point", [])
    if not points:
        print("No weight data found for this period.")
        return []

    for point in points:
        weight_kg = point["value"][0]["fpVal"]
        weight_lb = weight_kg * 2.20462
        weights.append(weight_lb)
    return weights


def get_average(l):
    if not l:
        return 0.0

    count = 0
    total = 0
    for weight in l:
        count += 1
        total += weight
    return total / count


if __name__ == "__main__":
    main()
