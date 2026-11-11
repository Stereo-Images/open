"""Run the current g29 workflow; earlier scripts are archived under source/."""
from pathlib import Path
import runpy

p = Path(__file__).resolve().parent
runpy.run_path(str(p/'build-g29.py'), run_name="__main__")
runpy.run_path(str(p/'build-batch.py'), run_name="__main__")
