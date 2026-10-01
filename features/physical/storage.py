import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DATA_FILE = DATA_DIR / "weight_data.json"


DEFAULT_DIET = {
    "phase": "cut",
    "calorie_intake": 2300,
    "protein_g": 215,
    "carbs_g": 149,
    "fat_g": 94,
    "protein_per_lb": 1.15,
}


def load():
    if not DATA_FILE.exists():
        return {
            "daily_weights": {},
            "weekly_averages": {},
            "diet": dict(DEFAULT_DIET),
            "diet_history": [],
        }
    with open(DATA_FILE, "r") as f:
        data = json.load(f)
    data.setdefault("daily_weights", {})
    data.setdefault("weekly_averages", {})
    data.setdefault("diet", dict(DEFAULT_DIET))
    data["diet"].setdefault("protein_per_lb", DEFAULT_DIET["protein_per_lb"])
    data.setdefault("diet_history", [])
    return data


def save(data):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def get_daily_weights(data=None):
    return (data or load())["daily_weights"]


def upsert_daily_weights(new_weights, data=None):
    data = data if data is not None else load()
    data["daily_weights"].update(new_weights)
    return data


def get_weekly_averages(data=None):
    return (data or load())["weekly_averages"]


def upsert_weekly_averages(new_averages, data=None):
    data = data if data is not None else load()
    data["weekly_averages"].update(new_averages)
    return data


def get_diet(data=None):
    return (data or load())["diet"]


def upsert_diet(new_diet, data=None):
    data = data if data is not None else load()
    data["diet"].update(new_diet)
    return data


def append_diet_history(entry, data=None):
    data = data if data is not None else load()
    data["diet_history"].append(entry)
    return data
