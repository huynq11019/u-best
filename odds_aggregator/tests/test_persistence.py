"""
Test case for token persistence in SABAIngestor.
"""
import os
import pytest
import json
from unittest.mock import patch, AsyncMock, MagicMock
from ingestors.saba import SABAIngestor, TOKEN_FILE

@pytest.fixture
def clean_token_file():
    # Setup: remove token file if exists
    if os.path.exists(TOKEN_FILE):
        os.remove(TOKEN_FILE)
    yield
    # Teardown: remove token file
    if os.path.exists(TOKEN_FILE):
        os.remove(TOKEN_FILE)

@pytest.mark.asyncio
async def test_token_persistence(clean_token_file):
    # 1. Khởi tạo ingestor khi không có cache, token nên lấy từ env (hoặc rỗng)
    with patch.dict(os.environ, {"SABA_TOKEN": "env-token"}):
        saba = SABAIngestor()
        assert saba._token == "env-token"

    # 2. Giả lập refresh thành công và kiểm tra file đã được lưu
    new_token = "new-refreshed-token"
    # Mock playwright call
    with patch("ingestors.saba.async_playwright") as mock_pw:
        # Mock browser, page, etc. to return our new token
        mock_browser = AsyncMock()
        mock_page = AsyncMock()
        mock_pw.return_value.__aenter__.return_value.chromium.launch.return_value = mock_browser
        mock_browser.new_page.return_value = mock_page
        
        # visitorInfo localStorage mock
        visitor_info = json.dumps({"OddsServerToken": new_token})
        mock_page.evaluate.return_value = visitor_info
        
        await saba._refresh_visitor_token()
        
        assert saba._token == new_token
        assert os.path.exists(TOKEN_FILE)
        with open(TOKEN_FILE, "r") as f:
            assert f.read() == new_token

    # 3. Khởi tạo ingestor mới, nó nên load từ file thay vì env
    with patch.dict(os.environ, {"SABA_TOKEN": "wrong-env-token"}):
        saba_new = SABAIngestor()
        assert saba_new._token == new_token
        assert saba_new._token != "wrong-env-token"
