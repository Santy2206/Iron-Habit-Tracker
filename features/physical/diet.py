from datetime import date, timedelta

from features.physical import weekly_average

# Weekly rate target as a fraction of bodyweight: (low, high) lbs/week.
# Cut is a single point target; bulk is a range.
PHASE_TARGETS = {
    "cut": (-0.005, -0.005),
    "bulk": (0.005, 0.01),
}

KCAL_PER_LB = 500  # ~3500 kcal/lb of bodyweight, spread over a week


def latest_bodyweight(daily_weights, weekly_averages):
    if daily_weights:
        latest_day = max(daily_weights)
        return daily_weights[latest_day]
    if weekly_averages:
        latest_week = max(weekly_averages)
        return weekly_averages[latest_week]
    return None


def four_week_rate(weekly_averages, today=None, weeks=4):
    """Average weekly lbs change over the last `weeks` completed weeks, using the
    telescoping difference between the most recent completed week and the one
    `weeks` weeks before it. Falls back to a shorter span if there isn't enough
    history yet, and returns None if fewer than 2 weeks are available."""
    today = today or date.today()
    current_monday = weekly_average.monday_of(today)

    available_mondays = sorted(
        m for m in (date.fromisoformat(k) for k in weekly_averages) if m < current_monday
    )
    if len(available_mondays) < 2:
        return None

    span = min(weeks, len(available_mondays) - 1)
    recent_monday = available_mondays[-1]
    past_monday = available_mondays[-1 - span]

    recent_value = weekly_averages[recent_monday.isoformat()]
    past_value = weekly_averages[past_monday.isoformat()]
    weeks_elapsed = (recent_monday - past_monday).days / 7
    return (recent_value - past_value) / weeks_elapsed


def target_rate_lbs(phase, bodyweight):
    low_pct, high_pct = PHASE_TARGETS[phase]
    return (low_pct * bodyweight, high_pct * bodyweight)


def check_status(phase, bodyweight, actual_rate):
    """Returns 'on_track', 'too_slow', or 'too_fast'. Uses a +/-30% tolerance
    band around the point target for cut, and the stated 0.5%-1% range for bulk,
    so a single noisy week doesn't trigger a false alarm."""
    if actual_rate is None or bodyweight is None:
        return None

    low, high = target_rate_lbs(phase, bodyweight)

    if phase == "cut":
        target = low  # low == high for cut
        if actual_rate > target * 0.7:
            return "too_slow"
        if actual_rate < target * 1.5:
            return "too_fast"
        return "on_track"
    else:  # bulk
        if actual_rate < low:
            return "too_slow"
        if actual_rate > high:
            return "too_fast"
        return "on_track"


def is_pending_reevaluation(weekly_averages, diet_history):
    """True when the diet targets were last changed after the most recent weekly
    average was logged - i.e. there's no new weigh-in data yet to judge whether
    the change worked, so the status/recommendation shouldn't re-alert on the
    same stale trend."""
    if not diet_history or not weekly_averages:
        return False
    last_change_date = date.fromisoformat(max(entry["date"] for entry in diet_history))
    latest_monday = max(date.fromisoformat(k) for k in weekly_averages)
    latest_data_through = latest_monday + timedelta(days=6)
    return last_change_date > latest_data_through


def estimate_maintenance(actual_rate, current_intake):
    """Back-calculates maintenance calories from the actual weight trend observed
    at the current intake."""
    return current_intake - actual_rate * KCAL_PER_LB


def intake_during_trend(diet_history, weekly_averages, fallback_intake):
    """The calorie intake that was actually in effect while the current weight
    trend was measured - the most recent diet_history entry logged at or before
    the most recent weekly average. A just-applied change hasn't had time to
    move the scale yet, so it shouldn't be used to back-calculate maintenance
    for a trend it didn't produce."""
    if not diet_history or not weekly_averages:
        return fallback_intake
    latest_monday = max(date.fromisoformat(k) for k in weekly_averages)
    cutoff = latest_monday + timedelta(days=6)
    eligible = [e for e in diet_history if date.fromisoformat(e["date"]) <= cutoff]
    if not eligible:
        return fallback_intake
    return max(eligible, key=lambda e: e["date"])["calorie_intake"]


def recommend(phase, bodyweight, actual_rate, current_intake, protein_per_lb=1.15, fat_g=80):
    """Back-calculates maintenance from the actual weight trend at the current
    intake, then suggests new calories/macros aimed at the phase's target rate."""
    low, high = target_rate_lbs(phase, bodyweight)
    target = (low + high) / 2

    maintenance = estimate_maintenance(actual_rate, current_intake)

    desired_offset = target * KCAL_PER_LB
    suggested_calories = maintenance + desired_offset

    protein_g = bodyweight * protein_per_lb
    carbs_g = max(0.0, (suggested_calories - protein_g * 4 - fat_g * 9) / 4)

    return {
        "maintenance_estimate": maintenance,
        "calorie_intake": suggested_calories,
        "protein_g": protein_g,
        "fat_g": fat_g,
        "carbs_g": carbs_g,
    }
