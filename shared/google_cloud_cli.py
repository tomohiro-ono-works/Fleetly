import shutil


def resolve_gcloud_command(*, which=None):
    lookup = which or shutil.which
    for candidate in ("gcloud.cmd", "gcloud.exe", "gcloud"):
        resolved = str(lookup(candidate) or "").strip()
        if resolved:
            return resolved
    raise FileNotFoundError("gcloud command was not found.")
