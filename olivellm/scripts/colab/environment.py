"""Reports the runtime environment and whether the Hugging Face token authenticates.

Prints status only. The token is read from the environment and is never echoed, logged, or included in the report.
"""

import json
import os
import platform

report = {"python": platform.python_version(), "token_present": bool(os.environ.get("HF_TOKEN"))}

try:
    import torch

    report["torch"] = torch.__version__
    report["cuda"] = bool(torch.cuda.is_available())
    report["device"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
except Exception as error:  # noqa: BLE001 - report the class only, never the message
    report["torch_error"] = type(error).__name__

try:
    import transformers

    report["transformers"] = transformers.__version__
except Exception as error:  # noqa: BLE001
    report["transformers_error"] = type(error).__name__

try:
    from huggingface_hub import HfApi

    # whoami() also returns the token itself in some versions, so only the account name is copied out.
    account = HfApi(token=os.environ.get("HF_TOKEN")).whoami()
    report["hf_authenticated"] = bool(account.get("name"))
    report["hf_account"] = account.get("name")
    report["hf_plan"] = account.get("plan")
except Exception as error:  # noqa: BLE001
    report["hf_authenticated"] = False
    report["hf_error"] = type(error).__name__

print("OLIVE_JSON_BEGIN")
print(json.dumps(report, indent=2))
print("OLIVE_JSON_END")
