"""Importador manual de extractos (PDF exportado a Excel/CSV) para el cuadre mensual.

Cada banco exporta con columnas distintas, asi que este importador recibe el
nombre de columna de fecha/descripcion/monto como argumentos en vez de
asumir un formato fijo.

Monto: si el extracto ya trae signo (negativo = salida, positivo = entrada),
usa --amount-col solo. Si trae el monto siempre positivo y la direccion en
otra columna, agrega --direction-col y --direction-out-value (el texto que
indica salida, ej. "Debito" o "Compra").

Ejemplo:
    python -m features.productive.finance.statement_importer \\
        --file extracto_bancolombia_septiembre.xlsx --account Bancolombia \\
        --date-col Fecha --desc-col Descripcion --amount-col Valor --commit
"""

import argparse
import hashlib
from pathlib import Path

import pandas as pd

from features.productive.finance import parsing
from features.productive.finance.supabase_client import get_client


def _read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in (".xlsx", ".xls"):
        return pd.read_excel(path)
    return pd.read_csv(path)


def _dedupe_hash(account: str, date: str, amount: float, description: str, index: int) -> str:
    raw = f"statement:{account}:{date}:{amount}:{description}:{index}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run(
    file_path: str,
    account_name: str,
    date_col: str,
    desc_col: str,
    amount_col: str,
    direction_col: str | None,
    direction_out_value: str | None,
    commit: bool,
):
    df = _read_table(Path(file_path))
    for required in (date_col, desc_col, amount_col):
        if required not in df.columns:
            raise SystemExit(f"Columna '{required}' no encontrada. Columnas disponibles: {list(df.columns)}")

    client = get_client() if commit else None
    account_id = parsing.get_account_id(client, account_name) if commit else None

    inserted, duplicates, skipped = 0, 0, 0

    for idx, row in df.iterrows():
        raw_amount = row[amount_col]
        description = str(row[desc_col])
        occurred_at = pd.to_datetime(row[date_col]).isoformat()

        amount_value = float(raw_amount)
        if direction_col:
            direction = "out" if str(row[direction_col]).strip() == direction_out_value else "in"
            amount_value = abs(amount_value)
        else:
            direction = "out" if amount_value < 0 else "in"
            amount_value = abs(amount_value)

        if amount_value <= 0:
            skipped += 1
            continue

        dedupe_hash = _dedupe_hash(account_name, occurred_at, amount_value, description, idx)
        print(f"[{idx}] {occurred_at} | {direction} | {amount_value} | {description[:60]!r}")

        if commit:
            ok = parsing.insert_transaction(
                client,
                account_id=account_id,
                occurred_at=occurred_at,
                direction=direction,
                amount=amount_value,
                source="statement",
                dedupe_hash=dedupe_hash,
                description=description,
                raw_text=description,
            )
            if ok:
                inserted += 1
            else:
                duplicates += 1

    print(
        f"\nTotal filas: {len(df)} | omitidas (monto 0): {skipped}"
        + (f" | insertadas: {inserted} | duplicadas: {duplicates}" if commit else " | (dry-run, nada se insertó)")
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True)
    parser.add_argument("--account", required=True, choices=["Bancolombia", "Nequi", "RappiCard", "Nu"])
    parser.add_argument("--date-col", required=True)
    parser.add_argument("--desc-col", required=True)
    parser.add_argument("--amount-col", required=True)
    parser.add_argument("--direction-col", default=None)
    parser.add_argument("--direction-out-value", default=None)
    parser.add_argument("--commit", action="store_true", help="Inserta en Supabase; sin esto, dry-run.")
    args = parser.parse_args()

    run(
        file_path=args.file,
        account_name=args.account,
        date_col=args.date_col,
        desc_col=args.desc_col,
        amount_col=args.amount_col,
        direction_col=args.direction_col,
        direction_out_value=args.direction_out_value,
        commit=args.commit,
    )


if __name__ == "__main__":
    main()
