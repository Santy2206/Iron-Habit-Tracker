from datetime import date, timedelta

LOOKBACK_WEEKS = 6


def monday_of(d):
    return d - timedelta(days=d.weekday())


def compute_week_average(monday, daily_weights):
    week_values = []
    for i in range(7):
        day_key = (monday + timedelta(days=i)).isoformat()
        if day_key in daily_weights:
            week_values.append(daily_weights[day_key])
    if not week_values:
        return None
    return sum(week_values) / len(week_values)


def sync_weekly_averages(daily_weights, weekly_averages, today=None, lookback_weeks=LOOKBACK_WEEKS):
    """Fills in the average for every week (Mon-Sun) in the lookback window whose
    Sunday has already happened - i.e. the week has ended - and isn't stored yet.
    A week's own Sunday counts as ended, so this correctly computes it on the
    last day of the week itself, not only once the following week has started."""
    today = today or date.today()
    updated = dict(weekly_averages)

    current_monday = monday_of(today)
    first_monday_to_check = current_monday - timedelta(weeks=lookback_weeks)

    monday = first_monday_to_check
    while monday <= current_monday:
        sunday = monday + timedelta(days=6)
        if sunday <= today:
            key = monday.isoformat()
            if key not in updated:
                average = compute_week_average(monday, daily_weights)
                if average is not None:
                    updated[key] = average
        monday += timedelta(weeks=1)

    return updated
