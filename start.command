#!/bin/bash
# Přepne do složky, kde se nachází tento skript
cd "$(dirname "$0")"

# Aktivuje virtuální prostředí a spustí aplikaci
source venv/bin/activate
python3 app.py