class ApplicationServiceError(Exception):
    def __init__(self, code, message):
        super().__init__(str(message or ""))
        self.code = str(code or "E_INTERNAL")
        self.message = str(message or "")
