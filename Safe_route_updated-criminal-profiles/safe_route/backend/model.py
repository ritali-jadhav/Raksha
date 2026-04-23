# backend/safety_model.py
import pandas as pd
import os

CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "crime_dataset_india.csv")

class SafetyModel:
    def __init__(self, csv_path=CSV_PATH):
        self.df = pd.read_csv(csv_path)
        self._prepare()

    def _prepare(self):
        # Normalize city names
        self.df['City'] = self.df['City'].astype(str).str.title().str.strip()

        # Extract hour from Time of Occurrence or Date+Time fallback
        # Try parsing Time of Occurrence directly; fallback to Date of Occurrence if needed.
        try:
            self.df['OccHour'] = pd.to_datetime(self.df['Time of Occurrence'], errors='coerce').dt.hour
        except Exception:
            self.df['OccHour'] = None

        # If NaN, try extracting from Date of Occurrence (if it contains time)
        mask = self.df['OccHour'].isna()
        if mask.any():
            self.df.loc[mask, 'OccHour'] = pd.to_datetime(
                self.df.loc[mask, 'Date of Occurrence'], errors='coerce'
            ).dt.hour

        # fill NaN hours with -1 (unknown)
        self.df['OccHour'] = self.df['OccHour'].fillna(-1).astype(int)

        # group counts by city + hour
        group = self.df.groupby(['City', 'OccHour']).size().reset_index(name='count')

        # compute global max for normalization (simple)
        global_max = group['count'].max() if not group.empty else 1
        group['risk'] = group['count'] / global_max  # 0..1

        # build dicts
        self.city_hour_risk = {
            (row['City'], int(row['OccHour'])): float(row['risk'])
            for _, row in group.iterrows()
        }
        # city average risk
        self.city_avg_risk = group.groupby('City')['risk'].mean().to_dict()
        self.overall_avg = group['risk'].mean() if not group.empty else 0.2

    def get_risk(self, city: str, hour: int):
        if city is None:
            return float(self.overall_avg)
        city = city.title().strip()
        key = (city, int(hour))
        if key in self.city_hour_risk:
            return float(self.city_hour_risk[key])
        if city in self.city_avg_risk:
            return float(self.city_avg_risk[city])
        return float(self.overall_avg)

# create global singleton to reuse
_model = None
def get_model():
    global _model
    if _model is None:
        _model = SafetyModel()
    return _model
