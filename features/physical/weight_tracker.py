import time
from datetime import datetime, timedelta
from pathlib import Path

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from features.physical import storage

SCOPES = ["https://www.googleapis.com/auth/fitness.body.read"]

# Always resolve against the project root so cwd (Task Scheduler, shortcuts, etc.)
# doesn't break auth file lookup.
TOKEN_PATH = storage.PROJECT_ROOT / "token.json"
CREDENTIALS_PATH = storage.PROJECT_ROOT / "credentials.json"


def main():
    creds = get_credentials()
    fitness_service = build("fitness", "v1", credentials=creds)
    time_range = get_time_range_for_weeks(6)
    daily_weights = get_weight_history(fitness_service, time_range)
    print(daily_weights)
    average = get_average(list(daily_weights.values()))
    print(f"Average weight: {average:.1f}")


def _delete_token():
    """Drop a bad/revoked token so the next step can start a clean OAuth flow."""
    try:
        TOKEN_PATH.unlink(missing_ok=True)
    except OSError as e:
        print(f"Could not remove bad token.json: {e}")


def _load_token():
    """Load token.json; returns None (and deletes the file) if it's corrupt."""
    if not TOKEN_PATH.exists():
        return None
    try:
        return Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    except Exception as e:
        print(f"token.json is unreadable/corrupt ({e}); removing it.")
        _delete_token()
        return None


def _save_token(creds):
    TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")


def _run_oauth_flow():
    """Open the browser so the user can authorize a fresh Google Fit token."""
    if not CREDENTIALS_PATH.exists():
        raise FileNotFoundError(
            f"Missing {CREDENTIALS_PATH.name} in the project root. "
            "Download the OAuth client JSON from Google Cloud Console and save it there."
        )
    print("Opening browser to authorize Google Fit…")
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), SCOPES)
    return flow.run_local_server(port=0)


def get_credentials():
    """Return valid Google Fit credentials.

    - Loads token.json if present.
    - Silently refreshes when expired (as long as the refresh token still works).
    - If the token is missing, corrupt, revoked, or the refresh fails, deletes the
      bad file and opens the browser OAuth flow to mint a new one automatically.
    """
    creds = _load_token()

    if creds and creds.valid:
        print("Successfully authenticated")
        return creds

    # Try a silent refresh first when we still have a refresh_token.
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_token(creds)
            print("Successfully authenticated (token refreshed)")
            return creds
        except RefreshError as e:
            print(f"Refresh token rejected ({e}); starting new sign-in.")
            _delete_token()
            creds = None
        except Exception as e:
            print(f"Could not refresh token ({e}); starting new sign-in.")
            _delete_token()
            creds = None

    # No usable token → interactive OAuth in the browser.
    creds = _run_oauth_flow()
    _save_token(creds)
    print("Successfully authenticated (new token)")
    return creds


def get_time_range_for_weeks(weeks_back):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(weeks=weeks_back)
    start_ns = int(start.timestamp() * 1000000000)
    end_ns = int(time.time() * 1000000000)
    return start_ns, end_ns


def get_weight_history(fitness_service, time_range):
    """Fetches weight readings in the range and returns {iso_date: avg_weight_lb},
    averaging together multiple same-day readings."""
    readings_by_day = {}
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
        return {}

    for point in points:
        weight_kg = point["value"][0]["fpVal"]
        weight_lb = weight_kg * 2.20462
        day = datetime.fromtimestamp(int(point["startTimeNanos"]) / 1e9).date()
        readings_by_day.setdefault(day.isoformat(), []).append(weight_lb)

    return {day: get_average(values) for day, values in readings_by_day.items()}


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
