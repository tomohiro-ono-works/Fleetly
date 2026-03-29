import os


class ZizSessionState:
    def __init__(self):
        self.last_report = None
        self.recent_flow_paths = []
        self.current_flow_path = None
        self.current_flow_name = None

    def remember_flow(self, flow_path):
        normalized = os.path.abspath(str(flow_path))
        self.recent_flow_paths = [
            path for path in self.recent_flow_paths
            if path != normalized
        ]
        self.recent_flow_paths.insert(0, normalized)

    def select_flow(self, flow_path):
        self.remember_flow(flow_path)
        self.current_flow_path = os.path.abspath(str(flow_path))
        self.current_flow_name = os.path.basename(self.current_flow_path)

    def clear_current_flow(self):
        self.current_flow_path = None
        self.current_flow_name = None
        self.last_report = None

    @property
    def in_flow_mode(self):
        return bool(self.current_flow_path)
