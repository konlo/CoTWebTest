import sys
from pathlib import Path
sys.path.append(".")
from app.config import Settings
from app.data_repository import DataRepository

settings = Settings()
repo = DataRepository(settings)
ims_list = repo.list_ims()
ims_5 = next((i for i in ims_list if i.ims_no == "5"), None)
print(f"IMS 5: {ims_5}")
if ims_5:
    print(f"Available sections: {ims_5.available_sections}")
    print(f"Missing sections: {ims_5.missing_sections}")
