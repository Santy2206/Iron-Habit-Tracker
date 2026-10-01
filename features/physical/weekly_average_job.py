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
    """Same token path as the GUI app, but never opens a browser.

    If the token is corrupt or the refresh is rejected, delete it and bail —
    the next interactive app launch will re-auth automatically.
    """
    from google.oauth2.credentials import Credentials

    token_path = weight_tracker.TOKEN_PATH
    if not token_path.exists():
        return None

    try:
        creds = Credentials.from_authorized_user_file(
            str(token_path), weight_tracker.SCOPES
        )
    except Exception as e:
        log(f"token.json unreadable ({e}); removed so the app can re-auth.")
        weight_tracker._delete_token()
        return None

    if creds and not creds.valid and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception as e:
            log(f"Token refresh failed ({e}); removed so the app can re-auth.")
            weight_tracker._delete_token()
            return None
        weight_tracker._save_token(creds)

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
