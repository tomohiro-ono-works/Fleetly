import logging
import os

def setup_logger():
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    logger = logging.getLogger("ziz")
    logger.setLevel(logging.INFO)
    logger.handlers = [] # 重複防止

    formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')

    # コンソール出力
    sh = logging.StreamHandler()
    sh.setFormatter(formatter)
    logger.addHandler(sh)

    return logger
