import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.logger import setup_logger, shutdown_logger


def main():
    log_dir = Path(sys.argv[1])
    mode = sys.argv[2]
    debug = sys.argv[3] == "1"
    setup_logger(mode=mode, debug=debug, log_dir=log_dir)
    logger = logging.getLogger("ziz.probe")
    logger.info(r"path=C:\Users\probe\input.csv password=secret-value")
    logger.debug(r"debug path=C:\Users\probe\debug.csv")
    shutdown_logger()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
