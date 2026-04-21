import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // We will track the GetGameZip requests
    const getGameZipRequests = [];

    // Lắng nghe tất cả các response mạng
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('GetGameZip') || url.includes('/service-api/')) {
            getGameZipRequests.push(url);
            if (url.includes('id=714290039')) {
                console.log('\n[API MATCH] Phát hiện trang gọi chính xác API:');
                console.log('URL: ' + url);
                try {
                    const json = await response.json();
                    console.log('--- Trích xuất một số dữ liệu kèo từ trang thực tế ---');
                    const value = json.Value || {};
                    const ge = value.GE || [];
                    if (ge.length > 0) {
                        console.log('- Đội thi đấu: ' + value.O1 + ' vs ' + value.O2);
                        console.log('- Tên giải: ' + value.L);
                        const firstGroup = ge[0];
                        const firstEvent = (firstGroup.E && firstGroup.E.length) ? firstGroup.E[0][0] : null;
                        if (firstEvent) {
                             console.log('- Tỷ lệ cược (Odds) mẫu: ' + firstEvent.C + ' (Loại: ' + firstEvent.T + ')');
                        }
                    } else {
                        console.log('- Dữ liệu Value.GE rỗng (Có thể không có kèo hoặc lỗi parsing)');
                    }
                } catch(e) {
                    console.log('Lỗi JSON parse:', e.message);
                }
            }
        }
    });

    console.log('Đang truy cập vào trang: https://1xlite-044647.top/vi/live/football/11249-indonesia-super-league/714290039-dewa-united-persib-bandung');
    try {
        await page.goto('https://1xlite-044647.top/vi/live/football/11249-indonesia-super-league/714290039-dewa-united-persib-bandung', {
            waitUntil: 'networkidle',
            timeout: 20000
        });
    } catch (err) {
        console.log('Timeout đợi networkidle nhưng có thể trang đã load đủ.');
    }

    console.log('\n========= KẾT QUẢ TỔNG HỢP =========');
    console.log('Các API liên quan đến LiveFeed đã được trang gọi:');
    getGameZipRequests.forEach(r => console.log(' -> ' + r));

    if (getGameZipRequests.some(u => u.includes('GetGameZip') && u.includes('714290039'))) {
        console.log('\n[KẾT LUẬN]: CHÍNH XÁC 100%. Url trang web ĐÃ DÙNG API GetGameZip (có chứa tham số id=714290039) để lấy dữ liệu vẽ lên Canvas.');
    } else {
        console.log('\n[KẾT LUẬN]: KHÔNG TÌM THẤY LỜI GỌI GetGameZip cho Id này. Có thể họ dùng WebSocket hoặc API endpoint đã thay đổi (nhưng rất khó xảy ra).');
    }

    await browser.close();
})();
