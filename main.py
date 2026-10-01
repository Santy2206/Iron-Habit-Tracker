import sys

from features import shell

shell.run(weekly_check="--weekly-check" in sys.argv)
