import tempfile
import time
from pathlib import Path
from app.board.storage import delete_ticket

def test_delete_ticket_removes_folder():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "ticket1"
        folder.mkdir()

        file = folder / "ticket.json"
        file.write_text("{}")
        delete_ticket(file)
        time.sleep(1.5)
        assert not folder.exists()