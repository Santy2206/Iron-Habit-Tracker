"""Headless job meant to run unattended (e.g. from Windows Task Scheduler).

Fetches recent Google Fit readings, merges them into local storage, and fills
in any missing weekly averages (both the week that just ended and any older
week within the lookback window that was never computed). Never launches a
browser: if the stored credentials can't be silently refreshed, it logs the
failure and exits instead of hanging waiting for interactive login.
"""

import sys
from datetime import datetime

from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from features.physical import storage, weekly_average, weight_tracker
from features.physical.weekly_average import LOOKBACK_WEEKS

LOG_FILE = storage.DATA_DIR / "weekly_average_job.log"


def log(message):
    storage.DATA_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat(timespec="seconds")
    with open(LOG_FILE, "a") as f:
        f.write(f"[{timestamp}] {message}\n")


def get_credentials_noninteractive():
    import os

    from google.oauth2.credentials import Credentials

    if not os.path.exists("./token.json"):
        return None
    creds = Credentials.from_authorized_user_file("./token.json", weight_tracker.SCOPES)
    if creds and not creds.valid and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception:
            return None
        with open("token.json", "w") as token:
            token.write(creds.to_json())
    if not creds or not creds.valid:
        return None
    return creds


def main():
    creds = get_credentials_noninteractive()
    if creds is None:
        log("No valid credentials available; open the app once to sign in. Skipped.")
        sys.exit(1)

    data = storage.load()
    try:
        fitness_service = build("fitness", "v1", credentials=creds)
        time_range = weight_tracker.get_time_range_for_weeks(LOOKBACK_WEEKS)
        fetched = weight_tracker.get_weight_history(fitness_service, time_range)
        storage.upsert_daily_weights(fetched, data)
    except Exception as e:
        log(f"Google Fit fetch failed, syncing from local data only: {e}")

    before = set(data["weekly_averages"])
    data["weekly_averages"] = weekly_average.sync_weekly_averages(
        data["daily_weights"], data["weekly_averages"], lookback_weeks=LOOKBACK_WEEKS
    )
    storage.save(data)

    new_weeks = sorted(set(data["weekly_averages"]) - before)
    if new_weeks:
        log(f"Computed weekly averages for: {', '.join(new_weeks)}")
    else:
        log("No new weekly averages to compute.")


if __name__ == "__main__":
    main()
