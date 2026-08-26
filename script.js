// =====================================================================
// 1. INITIALIZATION & CORE SETUP
// =====================================================================

document.addEventListener("DOMContentLoaded", () => {
  // 1.1 PWA Service Worker Registration
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("service-worker.js")
        .then(() => console.log("ServiceWorker registration successful"))
        .catch((err) => console.log("ServiceWorker registration failed: ", err));
    });
  }

  const App = {
    // =================================================================
    // 1.2 PROPERTIES & STATE
    // =================================================================
    currentUser: null,
    data: {
      users: [],
      products: [],
      sales: [],
      stockIns: [],
      stockOuts: [],
      stores: [],
      backupPassword: null,
      autoReport: {
        enabled: false,
        sendTime: "21:00",
        chatId: "",
        botToken: "",
        reportDateMode: "0",
        sellerMode: "all",
        sellerIds: [],
        lastSentDate: ""
      },
      _meta: {
        deviceId: null,
        lastLocalUpdate: 0,
        lastCloudSync: 0,
      },
    },
    cart: [],
    summaryContext: {},
    editingSaleContext: null,
    editingStockInId: null,
    editingStockOutId: null,
    posTimeInterval: null,
    posTimeManuallyChanged: false,
    _isInitialSync: false,
    _unsubscribe: null,

    // =================================================================
    // 2. INITIALIZATION METHODS
    // =================================================================
    
    // 2.1 Main Initialization
    async init() {
      this.loadLocalData();
      this.ensureAdminExists();
      this.restoreLoginState();
      this.fillPages();
      this.renderUI();
      await this.initFirebaseAndSync();
    },
    
    // 2.2 Load Local Data
    loadLocalData() {
      try {
        const raw = localStorage.getItem("posData");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!parsed.autoReport) {
            parsed.autoReport = {
              enabled: false,
              sendTime: "21:00",
              chatId: "",
              botToken: "",
              reportDateMode: "0",
              sellerMode: "all",
              sellerIds: [],
              reportFormat: "image",
              lastSentDate: "",
              lastSentDateTime: ""
            };
          }
          this.data = parsed;
          console.log("✅ โหลดข้อมูลจาก LocalStorage สำเร็จ");
        }
      } catch (e) {
        console.error("Local data corrupted", e);
      }

      if (!this.data || !Array.isArray(this.data.users)) {
        this.data = {
          users: [],
          products: [],
          sales: [],
          stockIns: [],
          stockOuts: [],
          stores: [],
          backupPassword: null,
          autoReport: {
            enabled: false,
            sendTime: "21:00",
            chatId: "",
            botToken: "",
            reportDateMode: "0",
            sellerMode: "all",
            sellerIds: [],
            reportFormat: "image",
            lastSentDate: "",
            lastSentDateTime: ""
          },
          _meta: {
            deviceId: crypto.randomUUID(),
            lastLocalUpdate: Date.now(),
            lastCloudSync: 0,
          },
        };
        console.log("📱 สร้างโครงสร้างข้อมูลเริ่มต้นในเครื่อง");
      }
      
      if (!this.data._meta) {
        this.data._meta = {
          deviceId: this.data._meta?.deviceId || crypto.randomUUID(),
          lastLocalUpdate: this.data._meta?.lastLocalUpdate || Date.now(),
          lastCloudSync: this.data._meta?.lastCloudSync || 0,
        };
      }
      
      if (!this.data._meta.deviceId) {
        this.data._meta.deviceId = crypto.randomUUID();
      }
    },
    
    // 2.3 Ensure Admin Exists
    ensureAdminExists() {
      if (!this.data.users.some(u => u.role === "admin")) {
        this.data.users.push({
          id: "static-admin-id-001",
          username: "admin",
          passwordHash: this.hash("123"),
          password: "123",
          role: "admin",
          createdAt: Date.now(),
        });
        this.saveLocal();
        console.log("👑 สร้างบัญชี admin เริ่มต้นสำเร็จ (Fixed ID)");
      }
    },
    
    // 2.4 Fill HTML Pages
    fillPages() {
      // Page: POS
      document.getElementById("page-pos").innerHTML = `
        <h2>ขายสินค้า (Point of Sale)</h2>
        <div class="pos-layout">
            <div>
                <form id="add-to-cart-form" style="max-width:none;">
                    <label for="pos-date-time-group">วันที่/เวลาขาย:</label>
                    <div id="pos-date-time-group" class="date-time-group">
                        <input type="date" id="pos-date">
                        <input type="time" id="pos-time">
                    </div>
                    <label for="pos-product">เลือกสินค้า:</label>
                    <select id="pos-product" required></select>
                    <label for="pos-quantity">จำนวน:</label>
                    <input type="number" id="pos-quantity" value="1" min="1" required>
                    <div id="special-price-container" style="display: none; grid-column: 1 / -1; grid-template-columns: 150px 1fr; align-items: center; gap: 15px;">
                        <label for="special-price">ราคาขายใหม่:</label>
                        <div>
                            <input type="number" id="special-price" placeholder="กรอกราคาต่อหน่วย" min="0" step="any">
                            <span id="current-price-info" style="font-size: 0.9em; color: #555; margin-left: 10px;"></span>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="success">เพิ่มลงตะกร้า</button>
                        <button type="button" id="toggle-special-price-btn">ใช้ราคาพิเศษ</button>
                    </div>
                </form>
                <h3>รายการในตะกร้า</h3>
                <div class="table-container">
                    <table id="cart-table">
                        <thead><tr><th>สินค้า</th><th>ราคาฯ</th><th>จำนวน</th><th>รวม</th><th>ลบ</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
            <div id="cart-summary">
                <div id="payment-method-container">
                    <h4>ประเภทการชำระเงิน</h4>
                    <div class="payment-options-wrapper">
                        <label><input type="radio" name="payment-method" value="เงินสด" checked> เงินสด</label>
                        <label><input type="radio" name="payment-method" value="เงินโอน"> เงินโอน</label>
                        <label><input type="radio" name="payment-method" value="เครดิต"> เครดิต</label>
                    </div>
                    <div id="transfer-fields-container">
                        <div style="margin-top:5px;"><label for="transfer-name" style="text-align:left;font-weight:bold;">ชื่อผู้โอน:</label><input type="text" id="transfer-name"></div>
                    </div>
                    <div id="credit-fields-container">
                        <div style="margin-top:5px;"><label for="credit-buyer-name" style="text-align:left;font-weight:bold;">ชื่อผู้ซื้อ (เครดิต):</label><input type="text" id="credit-buyer-name"></div>
                        <div style="margin-top:5px;"><label for="credit-due-days" style="text-align:left;font-weight:bold;">จำนวนวันเครดิต :</label><input type="number" id="credit-due-days" min="0" placeholder="เช่น 7, 15, 30"></div>
                    </div>
                </div>
                <div class="cart-action-row">
                    <span class="cart-total-label">สรุปยอด:</span>
                    <div id="cart-total">฿0.00</div>
                    <button id="process-sale-btn">ยืนยันการขาย</button>
                </div>
            </div>
        </div>`;

      // Page: Products
      document.getElementById("page-products").innerHTML = `
        <h2>จัดการสินค้า</h2>
        <p style="text-align:center; margin-top:-10px; margin-bottom:15px; font-size:0.9em;">ในหน้านี้ใช้สำหรับสร้างและแก้ไข <b>ชื่อสินค้า</b> และ <b>หน่วยนับ</b> เท่านั้น<br>ราคาทุนและราคาขาย จะถูกกำหนดในหน้า "นำเข้าสินค้า"</p>
        <form id="product-form">
            <input type="hidden" id="product-id">
            <label for="product-name">ชื่อสินค้า:</label>
            <input type="text" id="product-name" required>
            <label for="product-unit">หน่วย:</label>
            <input type="text" id="product-unit" placeholder="เช่น ชิ้น, กล่อง" required>
            <div class="form-actions">
                <button type="submit" class="success">บันทึกสินค้า</button>
                <button type="button" id="clear-product-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม</button>
            </div>
        </form>
        <div class="table-container">
            <table id="product-table">
                <thead><tr><th>ชื่อสินค้า</th><th>สต็อก</th><th>หน่วย</th><th>จัดการ</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>`;

      // Page: Stock In
      document.getElementById("page-stock-in").innerHTML = `
        <h2>บันทึกการนำเข้าสินค้า</h2>
        <p style="text-align:center; margin-top:-10px; margin-bottom:15px; font-size:0.9em;">เมื่อบันทึกการนำเข้า ราคาทุนและราคาขายล่าสุดของสินค้าจะถูกอัปเดตตามข้อมูลที่กรอกในหน้านี้</p>
        <form id="stock-in-form">
            <label for="stock-in-date-time-group">วันที่/เวลาที่นำเข้า:</label>
            <div id="stock-in-date-time-group" class="date-time-group">
                <input type="date" id="stock-in-date">
                <input type="time" id="stock-in-time">
            </div>
            <label for="stock-in-product">เลือกสินค้า:</label>
            <select id="stock-in-product" required></select>
            <label for="stock-in-quantity">จำนวน:</label>
            <input type="number" id="stock-in-quantity" min="1" required>
            <label for="stock-in-cost">ราคาทุนต่อหน่วย:</label>
            <input type="number" id="stock-in-cost" min="0" step="0.01" required>
            <label for="stock-in-price">ราคาขายต่อหน่วย:</label>
            <input type="number" id="stock-in-price" min="0" step="0.01" required>
            <div class="form-actions">
                <button type="submit" class="success">บันทึก</button>
                <button type="button" id="clear-stock-in-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม / ยกเลิกแก้ไข</button>
            </div>
        </form>
        <h3>ประวัติการนำเข้า</h3>
        <div class="table-container">
            <table id="stock-in-history-table">
                <thead><tr><th>วันที่</th><th>เวลา</th><th>สินค้า</th><th>จำนวน</th><th>ทุนต่อหน่วย</th><th>ยอดรวม</th><th>จัดการ</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>`;

      // Page: Stock Out
      document.getElementById("page-stock-out").innerHTML = `
        <h2>ปรับสต็อก (นำออก)</h2>
        <form id="stock-out-form">
            <label for="stock-out-date-time-group">วันที่/เวลาที่นำออก:</label>
            <div id="stock-out-date-time-group" class="date-time-group">
                <input type="date" id="stock-out-date">
                <input type="time" id="stock-out-time">
            </div>
            <label for="stock-out-product">เลือกสินค้า:</label>
            <select id="stock-out-product" required></select>
            <label for="stock-out-quantity">จำนวนที่นำออก:</label>
            <input type="number" id="stock-out-quantity" min="1" required>
            <label for="stock-out-reason">เหตุผล:</label>
            <input type="text" id="stock-out-reason" placeholder="เช่น หมดอายุ, ชำรุด, นับสต็อก" required>
            <div class="form-actions">
                <button type="submit" class="success">บันทึก</button>
                <button type="button" id="clear-stock-out-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม / ยกเลิกแก้ไข</button>
            </div>
        </form>
        <h3>ประวัติการนำออกล่าสุด</h3>
        <div class="table-container">
            <table id="stock-out-history-table">
                <thead><tr><th>วันที่</th><th>เวลา</th><th>สินค้า</th><th>จำนวน</th><th>เหตุผล</th><th>จัดการ</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>`;

      // Page: Sales History
      document.getElementById("page-sales-history").innerHTML = `
        <h2>รายการขายย้อนหลัง</h2>
        <div id="sales-history-export-form">
            <label>ตั้งแต่วันที่: <input type="date" id="export-sales-start-date"></label>
            <label>ถึงวันที่: <input type="date" id="export-sales-end-date"></label>
            <button type="button" id="export-sales-history-excel-btn">ส่งออกเป็น Excel</button>
        </div>
        <div class="table-container">
            <table id="sales-history-table">
                <thead><tr><th>วันที่</th><th>เวลา</th><th>รายการสินค้า</th><th>ยอดขายรวม</th><th>กำไรรวม</th><th>ประเภทชำระ</th><th>คนขาย</th><th>ร้านค้า</th><th>จัดการ</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>`;

      // Page: Reports
      document.getElementById("page-reports").innerHTML = `
        <h2>รายงานกำไร/ขาดทุน</h2>
        <form id="report-filter-form">
            <label>ตั้งแต่วันที่:<input type="date" id="report-start-date"></label>
            <label>ถึงวันที่:<input type="date" id="report-end-date"></label>
            <label>คนขาย:<select id="report-seller"><option value="all">ทั้งหมด</option></select></label>
            <button type="submit" id="report-generate-btn">สร้างรายงาน</button>
        </form>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 15px; text-align: center;">
            <div style="background: #f9f9f9; border: 1px solid var(--border-color); padding: 10px; border-radius: 5px;"> <h3>ยอดขายรวม</h3><p id="report-total-sales" style="font-size: 1.4em; font-weight: bold;">฿0.00</p> </div>
            <div style="background: #f9f9f9; border: 1px solid var(--border-color); padding: 10px; border-radius: 5px;"> <h3>ต้นทุนรวม</h3><p id="report-total-cost" style="font-size: 1.4em; font-weight: bold;">฿0.00</p> </div>
            <div style="background: #f9f9f9; border: 1px solid var(--border-color); padding: 10px; border-radius: 5px;"> <h3>กำไรสุทธิ</h3><p id="report-net-profit" style="font-size: 1.4em; font-weight: bold; color: var(--success-color);">฿0.00</p> </div>
        </div>`;

      // Page: Summary (Admin)
      document.getElementById("page-summary").innerHTML = `
        <h2>สรุปข้อมูล (สำหรับแอดมิน)</h2>
        <div class="summary-section" style="margin-bottom: 10px;">
            <h3 style="text-align:center; border:none; margin-bottom: 10px; font-size:1.1em;">1. เลือกผู้ขาย (จำเป็นสำหรับทุกรายงาน)</h3>
            <div class="summary-form-inline" style="justify-content: center;">
                <label for="summary-seller-select">ผู้ขาย:</label>
                <select id="summary-seller-select" style="text-align: left; max-width: 400px;"></select>
            </div>
        </div>
        <div class="collapsible-bar active" data-target="admin-quick-summary-content" style="background-color: #00B0F0;"><span>สรุปภาพรวมแบบรวดเร็ว</span><span class="arrow" style="transform: rotate(90deg);">▶</span></div>
        <div id="admin-quick-summary-content" class="collapsible-content active">
            <div style="text-align:center; padding:5px 0;">
                <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 15px;">
                    <button id="admin-summary-today-btn" style="background-color: var(--warning-color);">สรุปยอดขายวันนี้</button>
                    <button id="admin-summary-all-btn" style="background-color: #673ab7;">สรุปทั้งหมด</button>
                </div>
                <div class="summary-form-inline" style="justify-content: center; flex-direction: column; gap:8px; align-items: stretch; border-top: 1px solid #ddd; padding-top: 10px;">
                    <label>สรุปยอดขายตามวันที่เลือก: <input type="date" id="admin-summary-date" style="width: auto;"></label>
                    <button id="admin-summary-by-day-btn" style="background-color: #03a9f4; max-width: 300px; margin: auto;">สร้างรายงานตามวันที่</button>
                </div>
            </div>
        </div>
        <div class="collapsible-bar" data-target="admin-detailed-reports-content" style="background-color: #00B050;"><span>รายงานขั้นสูง (ตามช่วงเวลา)</span><span class="arrow">▶</span></div>
        <div id="admin-detailed-reports-content" class="collapsible-content">
            <div class="summary-section" id="admin-report-filters" style="border:none; padding: 5px 0;">
                <h4 style="text-align:center; margin-top:0; font-size:1em;">กำหนดช่วงเวลา</h4>
                <div class="summary-form-inline" style="justify-content: center;">
                    <label>จากวันที่:</label>
                    <input type="date" id="summary-custom-start-date" required>
                    <label>ถึงวันที่:</label>
                    <input type="date" id="summary-custom-end-date" required>
                </div>
            </div>
            <div class="report-action-buttons" style="gap:10px;">
                <div class="report-action-item">
                    <p><strong>สรุปภาพรวมตามช่วงเวลา</strong><br><small>(สรุปยอดขาย, กำไร/คอมมิชชั่น, จำนวนสินค้า)</small></p>
                    <button type="button" id="generate-aggregated-summary-btn" style="background-color: #673ab7;">สร้างรายงานสรุปภาพรวม</button>
                </div>
                <div class="report-action-item">
                    <p><strong>แจกแจงรายละเอียดการขาย</strong><br><small>(แสดงรายการขายทั้งหมดในช่วงเวลาที่เลือก)</small></p>
                    <div id="summary-payment-types" style="display: flex; gap: 10px; flex-wrap: wrap; padding: 8px; background-color: #eef5ff; border-radius: 6px; justify-content: center; margin-bottom: 8px; font-size:0.9em;">
                        <label style="font-weight:normal;"><input type="checkbox" value="เงินสด" checked> เงินสด</label>
                        <label style="font-weight:normal;"><input type="checkbox" value="เงินโอน" checked> เงินโอน</label>
                        <label style="font-weight:normal;"><input type="checkbox" value="เครดิต" checked> เครดิต</label>
                    </div>
                    <button type="button" id="generate-detailed-report-btn" class="success">สร้างรายงานแจกแจง</button>
                </div>
                <div class="report-action-item">
                    <p><strong>สรุปข้อมูลลูกหนี้ (เครดิต)</strong></p>
                    <button type="button" id="generate-credit-summary-btn" class="danger">สร้างรายงานลูกหนี้</button>
                </div>
                <div class="report-action-item">
                    <p><strong>สรุปข้อมูลเงินโอน</strong></p>
                    <button type="button" id="generate-transfer-summary-btn" style="background-color: #007bff;">สร้างรายงานเงินโอน</button>
                </div>
            </div>
        </div>`;

      // Page: Stores
      document.getElementById("page-stores").innerHTML = `
        <h2>จัดการร้านค้า</h2>
        <form id="store-form">
            <input type="hidden" id="store-id">
            <label for="store-name">ชื่อร้านค้า:</label>
            <input type="text" id="store-name" required>
            <div class="form-actions">
                <button type="submit" class="success">บันทึกร้านค้า</button>
                <button type="button" id="clear-store-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม</button>
            </div>
        </form>
        <div class="table-container">
            <table id="store-table">
                <thead><tr><th>ชื่อร้านค้า</th><th>จัดการ</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>`;

      // Page: Users
      document.getElementById("page-users").innerHTML = `
        <h2>จัดการผู้ใช้</h2>
        <form id="user-form" class="user-form-center">
            <input type="hidden" id="user-id">
            <div class="user-two-columns" style="grid-column: 1 / -1;">
                <div class="field-group">
                    <label for="user-username">ชื่อผู้ใช้:</label>
                    <input type="text" id="user-username" required>
                </div>
                <div class="field-group">
                    <label for="user-role">ประเภท:</label>
                    <select id="user-role" required>
                        <option value="seller">Seller</option>
                        <option value="admin">Admin</option>
                    </select>
                </div>
            </div>
            <div class="user-two-columns" style="grid-column: 1 / -1;">
                <div class="field-group">
                    <label for="user-password">รหัสผ่านใหม่:</label>
                    <input type="password" id="user-password" placeholder="กำหนดรหัสผ่านสำหรับผู้ใช้ใหม่">
                </div>
                <div class="field-group">
                    <label for="user-password-confirm">ยืนยันรหัสผ่าน:</label>
                    <input type="password" id="user-password-confirm" placeholder="ยืนยันรหัสผ่าน">
                </div>
            </div>
            <div class="form-group" style="display:flex; justify-content:center; align-items:center; gap:6px;">
                <input type="checkbox" id="show-password-user-form" style="width:18px; height:18px;">
                <label for="show-password-user-form" style="cursor:pointer; font-weight:normal; margin:0; display:flex; align-items:center;">แสดงรหัสผ่าน</label>
            </div>
            <div id="user-store-assignment-container" class="form-group"></div>
            <div id="user-commission-settings-container" class="form-group">
                <div style="display:flex; align-items:center; gap:10px;">
                    <h4 style="margin:0; white-space:nowrap;">ตั้งค่าคอมมิชชั่น:</h4>
                    <label for="user-commission-rate" style="margin:0; white-space:nowrap;">อัตรา (%):</label>
                    <input type="number" id="user-commission-rate" min="0" max="100" step="any" placeholder="เช่น 3, 5.5" style="flex:1;">
                </div>
            </div>
            <div class="form-group" style="display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap;">
                <label style="margin:0; white-space:nowrap;">คิดจากยอดขาย:</label>
                <div id="user-commission-sources" style="display:flex; align-items:center; gap:15px; flex-wrap:wrap;">
                    <label style="display:flex; align-items:center; gap:5px; white-space:nowrap;"><input type="checkbox" id="user-commission-cash"> เงินสด</label>
                    <label style="display:flex; align-items:center; gap:5px; white-space:nowrap;"><input type="checkbox" id="user-commission-transfer"> โอน</label>
                    <label style="display:flex; align-items:center; gap:5px; white-space:nowrap;"><input type="checkbox" id="user-commission-credit"> เครดิต</label>
                </div>
            </div>
            <div id="user-sales-period-container" class="form-group">
                <h4>กำหนดระยะเวลาที่สามารถขายได้</h4>
                <div class="user-two-columns">
                    <div class="field-group">
                        <label for="user-sales-start-date">วันที่เริ่มขาย:</label>
                        <input type="date" id="user-sales-start-date">
                    </div>
                    <div class="field-group">
                        <label for="user-sales-end-date">วันที่สิ้นสุด:</label>
                        <input type="date" id="user-sales-end-date">
                    </div>
                </div>
            </div>
            <div id="user-product-assignment-container" class="form-group">
                <h4>กำหนดสินค้าที่สามารถขายได้</h4>
                <div id="user-product-assignment" style="max-height:150px; overflow-y:auto; border:1px solid #BFBFBF; padding:10px; border-radius:10px;"></div>
            </div>
            <div id="user-history-view-container" class="form-group">
                <h4>จำนวนวันที่ดูประวัติขายได้</h4>
                <input type="number" id="user-visible-days" min="0" placeholder="เว้นว่างคือดูได้ทั้งหมด 0=วันนี้, 1=เมื่อวานด้วย" style="width:100%; box-sizing:border-box;">
            </div>
            <div class="form-actions">
                <button type="submit" class="success">บันทึกผู้ใช้</button>
                <button type="button" id="clear-user-form-btn" style="background-color:#6c757d;">เคลียร์ฟอร์ม</button>
            </div>
        </form>
        <div class="table-container">
            <table id="user-table">
                <thead><tr><th>ชื่อผู้ใช้</th><th>ประเภท</th><th>ร้านค้า</th><th>สินค้าที่ขายได้</th><th>ระยะเวลาที่ขายได้</th><th>จัดการ</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>`;

      // Page: Data Management
      document.getElementById("page-data").innerHTML = `
        <h2>จัดการข้อมูล</h2>
        <div class="data-management-section admin-only data-restore-section">
            <h3>โหลดข้อมูลจากไฟล์ (Restore)</h3>
            <p style="color: var(--danger-color); font-size:0.9em;"><b>คำเตือน:</b> การโหลดข้อมูลจากไฟล์จะรวมข้อมูลเข้ากับข้อมูลปัจจุบัน ข้อมูลที่ซ้ำกันจะถูกทับด้วยข้อมูลจากไฟล์!</p>
            <input type="file" id="data-file-input" style="display: none;" accept=".json,application/json">
            <button type="button" id="load-from-file-btn" style="background-color: #E97132;">เลือกไฟล์สำรอง (.json)</button>
        </div>
        <div class="data-management-section admin-only">
            <h3>ตั้งรหัสผ่านสำหรับไฟล์สำรอง</h3>
            <p style="font-size:0.9em;">รหัสผ่านนี้จะใช้เข้ารหัสไฟล์สำรองข้อมูลที่สร้างโดยแอดมินโดยอัตโนมัติ</p>
            <form id="backup-password-form" style="max-width: 400px;">
                <div class="form-group"><label for="backup-password">รหัสผ่านใหม่ (เว้นว่างเพื่อลบ):</label><input type="password" id="backup-password" placeholder="พิมพ์รหัสผ่านที่นี่"></div>
                <div class="form-group"><label for="backup-password-confirm">ยืนยันรหัสผ่านใหม่:</label><input type="password" id="backup-password-confirm" placeholder="พิมพ์รหัสผ่านอีกครั้ง"></div>
                <div class="form-group">
                    <label style="font-weight: normal; cursor: pointer;">
                        <input type="checkbox" id="show-backup-password"> แสดงรหัสผ่าน
                    </label>
                </div>
                <div class="form-actions" style="justify-content: center;">
                    <button type="submit" class="success">บันทึกรหัสผ่าน</button>
                </div>
            </form>
            <p id="password-status" style="font-weight: bold; margin-top: 10px; font-size:0.9em;"></p>
        </div>
        <div class="data-management-section admin-only">
            <h3>สำรองข้อมูล (Backup)</h3>
            <p style="font-size:0.9em;">สำรองข้อมูลทั้งหมด (ผู้ใช้, สินค้า, ประวัติการขาย) ลงในไฟล์ JSON เพื่อเก็บไว้หรือย้ายไปยังเครื่องอื่น</p>
            <button id="save-to-file-btn" class="success">บันทึกข้อมูลทั้งหมดลงไฟล์</button>
            <button id="save-to-browser-btn" style="background-color: #007bff;">บันทึกชั่วคราวลงในเบราว์เซอร์</button>
        </div>
        <div class="data-management-section admin-only" style="border-color: var(--danger-color);">
            <h3 style="color: var(--danger-color);">รีเซ็ตข้อมูล (*** การกระทำนี้ไม่สามารถย้อนกลับได้ ***)</h3>
            <p style="font-size:0.9em;">เลือกเพื่อล้างข้อมูลเฉพาะส่วนที่ต้องการ</p>
            <button id="open-reset-modal-btn" class="danger">เปิดหน้าต่างรีเซ็ตข้อมูล</button>
        </div>
        <div class="collapsible-bar admin-only" data-target="admin-stock-report-content" style="background-color: #00B050;"><span>รายงานสต็อกสินค้า</span><span class="arrow">▶</span></div>
        <div id="admin-stock-report-content" class="collapsible-content admin-only">
            <div style="text-align:center; padding: 5px;">
                <p style="font-size:0.9em;">รายงานนี้จะเปรียบเทียบสต็อกที่คำนวณได้จากประวัติ (นำเข้า - ขาย - ปรับออก) กับสต็อกที่บันทึกไว้ปัจจุบัน</p>
                <button id="generate-stock-report-btn" class="success">สร้างรายงานสต็อก (ปัจจุบัน)</button>
                <button id="generate-yesterday-stock-report-btn" style="background-color: #007bff;">รายงานสต็อก (สิ้นวันก่อนหน้า)</button>
                <button id="recalculate-stock-btn" class="danger">คำนวณสต็อกใหม่ทั้งหมด</button>
            </div>
            <div id="stock-summary-report-container" style="margin-top: 10px;"></div>
        </div>
        <div class="collapsible-bar seller-only" data-target="seller-backup-content"><span>บันทึกข้อมูล (Backup)</span><span class="arrow">▶</span></div>
        <div id="seller-backup-content" class="collapsible-content seller-only"><div style="text-align:center; padding-top: 5px;"><p style="margin-top:0; font-size:0.9em;">สำรองข้อมูลทั้งหมด (ผู้ใช้, สินค้า, ประวัติการขาย) ลงในไฟล์ JSON เพื่อเก็บไว้หรือย้ายไปยังเครื่องอื่น</p><button id="save-to-file-btn-seller" class="success">บันทึกข้อมูลทั้งหมดลงไฟล์</button><button id="save-to-browser-btn-seller" style="background-color: #007bff;">บันทึกข้อมูลชั่วคราวในเบราว์เซอร์</button></div></div>
        <div class="collapsible-bar seller-only" data-target="seller-summary-content"><span>รายงานสรุป (สำหรับผู้ใช้ปัจจุบัน)</span><span class="arrow">▶</span></div>
        <div id="seller-summary-content" class="collapsible-content seller-only"><div style="text-align:center;"><div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;"><button id="my-summary-today-btn" style="background-color: var(--warning-color);">สรุปยอดขายวันนี้</button><button id="my-summary-all-btn" style="background-color: #673ab7;">สรุปทั้งหมดของฉัน</button></div><div class="summary-form-inline" style="margin-top: 10px; justify-content: center; flex-direction: column; gap:8px; align-items: stretch;"><label>เลือกวันที่: <input type="date" id="my-summary-date" style="width:100%;"></label><button id="my-summary-by-day-btn" style="background-color: #03a9f4;">สรุปยอดขายวันที่เลือก</button></div><div class="summary-form-inline" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd; justify-content: center; flex-direction: column; gap:8px; align-items: stretch;"><div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;"><label>จากวันที่: <input type="date" id="my-summary-start-date"></label><label>ถึงวันที่: <input type="date" id="my-summary-end-date"></label></div><button id="my-summary-by-range-btn" style="background-color: #ff9800;">สรุปยอดขายตามช่วงวันที่</button></div></div></div>
        <div class="collapsible-bar seller-only" data-target="seller-detailed-report-content" style="background-color: #ED01ED;"><span>แจกแจงรายละเอียดการขาย</span><span class="arrow">▶</span></div>
        <div id="seller-detailed-report-content" class="collapsible-content seller-only">
            <form id="seller-detailed-report-form" class="summary-section" style="display: grid; grid-template-columns: 1fr; gap: 15px; max-width: 800px; margin: auto; padding: 10px;">
                <div>
                    <h4 style="text-align: left; margin-bottom: 5px; padding-left: 5px; font-size:1em;">1. เลือกประเภทการชำระ</h4>
                    <div id="seller-report-payment-types" style="display: flex; gap: 10px; flex-wrap: wrap; padding: 8px; background-color: #eef5ff; border-radius: 6px; justify-content: center; font-size:0.9em;">
                        <label style="font-weight: normal; cursor: pointer;"><input type="checkbox" value="เงินสด" checked> เงินสด</label>
                        <label style="font-weight: normal; cursor: pointer;"><input type="checkbox" value="เงินโอน" checked> เงินโอน</label>
                        <label style="font-weight: normal; cursor: pointer;"><input type="checkbox" value="เครดิต" checked> เครดิต</label>
                    </div>
                </div>
                <div>
                    <h4 style="text-align: left; margin-bottom: 5px; padding-left: 5px; font-size:1em;">2. เลือกช่วงเวลา</h4>
                    <div class="summary-form-inline" style="justify-content: space-around; gap:10px;">
                        <label style="font-weight: normal;">จากวันที่: <input type="date" id="seller-report-start-date" required></label>
                        <label style="font-weight: normal;">ถึงวันที่: <input type="date" id="seller-report-end-date" required></label>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="success" style="width: 100%; max-width: 300px; padding: 10px; font-size: 1.1em;">3. สรุปรายงาน</button>
                </div>
            </form>
        </div>
        <div class="collapsible-bar seller-only" data-target="seller-credit-report-content" style="background-color: #d32f2f;"><span>สรุปข้อมูลลูกหนี้ (เครดิต)</span><span class="arrow">▶</span></div>
        <div id="seller-credit-report-content" class="collapsible-content seller-only">
            <form id="seller-credit-report-form" class="summary-section" style="padding: 10px; margin: 0 auto; border: none;">
                <h4 style="text-align: center; margin-top:0; font-size:1em;">เลือกช่วงเวลาที่ต้องการสรุป</h4>
                <div class="summary-form-inline" style="justify-content: space-around; gap:10px;">
                    <label style="font-weight: normal;">จากวันที่: <input type="date" id="seller-credit-start-date" required></label>
                    <label style="font-weight: normal;">ถึงวันที่: <input type="date" id="seller-credit-end-date" required></label>
                </div>
                <div class="form-actions" style="margin-top: 10px;">
                    <button type="submit" class="danger" style="width: 100%; max-width: 300px; padding: 10px;">สร้างรายงานลูกหนี้</button>
                </div>
            </form>
        </div>
        <div class="collapsible-bar seller-only" data-target="seller-transfer-report-content" style="background-color: #1976d2;"><span>สรุปข้อมูลเงินโอน</span><span class="arrow">▶</span></div>
        <div id="seller-transfer-report-content" class="collapsible-content seller-only">
            <form id="seller-transfer-report-form" class="summary-section" style="padding: 10px; margin: 0 auto; border: none;">
                <h4 style="text-align: center; margin-top:0; font-size:1em;">เลือกช่วงเวลาที่ต้องการสรุป</h4>
                <div class="summary-form-inline" style="justify-content: space-around; gap:10px;">
                    <label style="font-weight: normal;">จากวันที่: <input type="date" id="seller-transfer-start-date" required></label>
                    <label style="font-weight: normal;">ถึงวันที่: <input type="date" id="seller-transfer-end-date" required></label>
                </div>
                <div class="form-actions" style="margin-top: 10px;">
                    <button type="submit" style="background-color: #007bff; width: 100%; max-width: 300px; padding: 10px;">สร้างรายงานเงินโอน</button>
                </div>
            </form>
        </div>
        <div class="collapsible-bar seller-only active" data-target="seller-sales-history-container"><span>ค้นหารายการขาย</span><span class="arrow" style="transform: rotate(90deg);">▶</span></div>
        <div id="seller-sales-history-container" class="collapsible-content seller-only active">
            <form id="seller-sales-filter-form" style="max-width: none; background-color: #eef5ff; padding: 15px; border-radius: 8px; border: 1px solid #cce5ff;">
                <div style="display:flex; flex-wrap:wrap; gap: 20px; justify-content:center; align-items:center; margin-bottom: 15px;">
                    <label style="cursor:pointer; font-weight:bold;"><input type="radio" name="seller-filter-type" value="today" checked> วันนี้</label>
                    <label style="cursor:pointer; font-weight:bold;"><input type="radio" name="seller-filter-type" value="by_date"> เลือกวันที่</label>
                    <label style="cursor:pointer; font-weight:bold;"><input type="radio" name="seller-filter-type" value="by_range"> เลือกช่วงเวลา</label>
                </div>
                <div id="seller-date-inputs" style="display:flex; flex-direction:column; align-items:center; gap: 10px; min-height: 40px;">
                    <div id="seller-filter-by-date-div" style="display:none;">
                        <label style="font-weight:normal;">วันที่ต้องการดู: <input type="date" id="seller-filter-date" style="padding: 5px; border-radius: 4px; border: 1px solid #ccc;"></label>
                    </div>
                    <div id="seller-filter-by-range-div" style="display:none; gap:10px; flex-wrap:wrap; justify-content:center;">
                        <label style="font-weight:normal;">จาก: <input type="date" id="seller-filter-start-date" style="padding: 5px; border-radius: 4px; border: 1px solid #ccc;"></label>
                        <label style="font-weight:normal;">ถึง: <input type="date" id="seller-filter-end-date" style="padding: 5px; border-radius: 4px; border: 1px solid #ccc;"></label>
                    </div>
                </div>
                <div class="form-actions" style="margin-top: 15px; justify-content: center;">
                    <button type="submit" style="background-color:#008CBA; padding: 10px 25px; font-size: 1em;">🔍 ค้นหารายการ</button>
                </div>
            </form>
            <div class="table-container" style="margin-top:15px;">
                <table id="seller-sales-history-table">
                    <thead>
                        <tr>
                            <th>วันที่</th>
                            <th>เวลา</th>
                            <th>รายการสินค้า</th>
                            <th>ยอดขาย</th>
                            <th>ประเภทชำระ</th>
                            <th>จัดการ</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>`;
      
      if (!this.data._meta.deviceId) {
        this.data._meta.deviceId = crypto.randomUUID();
      }
    },

    // =================================================================
    // 3. AUTHENTICATION & UI MANAGEMENT
    // =================================================================
    
    // 3.1 Login
    login(username, password) {
      username = username.trim();
      const user = this.data.users.find(
        u => u.username === username && (this.verify(password, u.passwordHash) || u.password === password)
      );
      if (!user) {
        this.showToast("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "error");
        return;
      }
      this.currentUser = user;
      const rememberMe = document.getElementById("remember-me")?.checked || false;
      if (rememberMe) {
        localStorage.setItem("posCurrentUser", JSON.stringify({ id: user.id }));
      } else {
        sessionStorage.setItem("posCurrentUser", JSON.stringify({ id: user.id }));
      }
      this.showMainApp();
    },
    
    // 3.2 Restore Login State
    restoreLoginState() {
      let raw = localStorage.getItem("posCurrentUser");
      if (!raw) raw = sessionStorage.getItem("posCurrentUser");
      if (!raw) {
        this.showLoginScreen();
        return;
      }
      try {
        const { id } = JSON.parse(raw);
        const user = this.data.users.find(u => u.id === id);
        if (!user) {
          localStorage.removeItem("posCurrentUser");
          sessionStorage.removeItem("posCurrentUser");
          this.showLoginScreen();
          return;
        }
        this.currentUser = user;
        this.showMainApp();
      } catch (e) {
        console.error("Error restoring login state:", e);
        this.showLoginScreen();
      }
    },
    
    // 3.3 Show Main App
    showMainApp() {
      document.getElementById("login-screen").style.display = "none";
      document.getElementById("main-app").style.display = "block";
      document.getElementById("user-info").textContent = `ผู้ใช้: ${this.currentUser.username} (${this.currentUser.role})`;
      this.updateUIPermissions();
      document.querySelectorAll(".section-content.active").forEach((openSection) => {
        openSection.classList.remove("active");
        if (openSection.previousElementSibling) openSection.previousElementSibling.classList.remove("active");
      });
      if (this.currentUser.role === "seller") this.showPage("page-pos");
      setTimeout(() => this.checkAutoReport(), 3000);
    },
    
    // 3.4 Show Login Screen
    showLoginScreen() {
      document.getElementById("login-screen").style.display = "block";
      document.getElementById("main-app").style.display = "none";
    },
    
    // 3.5 Logout
    logout() {
      this.currentUser = null;
      sessionStorage.removeItem("posCurrentUser");
      localStorage.removeItem("posCurrentUser");
      if (this._unsubscribe) {
        this._unsubscribe();
        this._unsubscribe = null;
      }
      document.querySelectorAll(".section-content.active").forEach(el => {
        el.classList.remove("active");
        if (el.previousElementSibling) el.previousElementSibling.classList.remove("active");
      });
      this.showLoginScreen();
    },
    
    // 3.6 Show Page
    showPage(pageId, payload = null) {
      const sellerAllowedPages = ["page-pos", "page-data"];
      const section = document.getElementById(pageId);
      if (!section) return;
      if (this.currentUser.role === "seller" && !sellerAllowedPages.includes(pageId)) {
        this.showToast("คุณไม่มีสิทธิ์เข้าถึงหน้านี้");
        return;
      }
      this.updateUIPermissions();
      const wasActive = section.classList.contains("active");
      if (!wasActive) {
        switch (pageId) {
          case "page-pos": this.renderPos(payload); break;
          case "page-products": this.renderProductTable(); break;
          case "page-stock-in": this.renderStockIn(); break;
          case "page-stock-out": this.renderStockOut(); break;
          case "page-sales-history": this.renderSalesHistory(); break;
          case "page-reports": this.renderReport(); break;
          case "page-summary": this.renderSummaryPage(); break;
          case "page-stores": this.renderStoreTable(); break;
          case "page-users": this.renderUserTable(); break;
          case "page-auto-report": this.renderAutoReportPage(); break;
          case "page-data":
            if (this.currentUser.role === "seller") this.renderSellerSalesHistoryWithFilter();
            else if (this.currentUser.role === "admin") this.renderBackupPasswordStatus();
            break;
        }
      }
      this.toggleSection(pageId);
    },
    
    // 3.7 Toggle Section
    toggleSection(sectionId) {
      const currentlyOpen = document.querySelector(".section-content.active");
      if (currentlyOpen && currentlyOpen.id !== sectionId) {
        currentlyOpen.classList.remove("active");
        if (currentlyOpen.previousElementSibling) currentlyOpen.previousElementSibling.classList.remove("active");
      }
      const section = document.getElementById(sectionId);
      if (section) {
        const header = section.previousElementSibling;
        section.classList.toggle("active");
        if (header) header.classList.toggle("active");
      }
    },
    
    // 3.8 Update UI Permissions
    updateUIPermissions() {
      if (!this.currentUser) return;
      const isAdmin = this.currentUser.role === "admin";
      document.querySelectorAll(".admin-only").forEach((el) => (el.style.display = isAdmin ? "" : "none"));
      document.querySelectorAll(".seller-only").forEach((el) => (el.style.display = !isAdmin ? "" : "none"));
      const storeNameSpan = document.getElementById("store-display-name");
      if (storeNameSpan) {
        if (this.currentUser.role === "seller" && this.currentUser.storeId) {
          const store = this.data.stores.find((s) => s.id === this.currentUser.storeId);
          storeNameSpan.textContent = store ? `- ${store.name}` : "";
        } else {
          storeNameSpan.textContent = "";
        }
      }
    },
    
    // 3.9 Render UI
    renderUI() {
      if (this.currentUser) {
        this.showMainApp();
        this.showPage(this.currentUser.role === "admin" ? "page-admin" : "page-pos");
      } else {
        this.showLoginScreen();
      }
      this.attachEventListeners();
    },
    
    // 3.10 Refresh Current Page
    refreshCurrentPage() {
      const activeSection = document.querySelector(".section-content.active");
      if (!activeSection) return;
      const pageId = activeSection.id;
      console.log("♻️ Refreshing page:", pageId);
      if (pageId === "page-pos") this.renderPos();
      else if (pageId === "page-products") this.renderProductTable();
      else if (pageId === "page-stock-in") this.renderStockIn();
      else if (pageId === "page-stock-out") this.renderStockOut();
      else if (pageId === "page-sales-history") this.renderSalesHistory();
      else if (pageId === "page-stores") this.renderStoreTable();
      else if (pageId === "page-users") this.renderUserTable();
      else if (pageId === "page-reports") this.renderReport();
      else if (pageId === "page-summary") this.renderSummaryPage();
      else if (pageId === "page-auto-report") this.renderAutoReportPage();
      else if (pageId === "page-data") {
        if (this.currentUser.role === "seller") this.renderSellerSalesHistoryWithFilter();
        else {
          this.renderBackupPasswordStatus();
          if (document.getElementById("stock-summary-report-container")?.innerHTML !== "") this.renderStockSummaryReport();
        }
      }
      this.showToast('ข้อมูลอัปเดตจากเครื่องอื่นแล้ว', 'info');
    },

    // =================================================================
    // 4. HELPER & UTILITY FUNCTIONS
    // =================================================================
    
    // 4.1 Show Toast
    showToast(message, type = "success") {
      const toast = document.getElementById("toast-notification");
      if (!toast) return;
      toast.textContent = message;
      if (type === "error") toast.style.backgroundColor = "var(--danger-color)";
      else if (type === "warning") toast.style.backgroundColor = "var(--warning-color)";
      else if (type === "info") toast.style.backgroundColor = "var(--info-color)";
      else toast.style.backgroundColor = "var(--success-color)";
      toast.className = "show";
      setTimeout(() => {
        toast.className = toast.className.replace("show", "");
      }, 3000);
    },
    
    // 4.2 Format Number Smart
    formatNumberSmart(num) {
      if (typeof num !== "number" || isNaN(num)) return num;
      if (num % 1 === 0) return num.toLocaleString("th-TH");
      else return num.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    
    // 4.3 Format Thai Date Short Year
    formatThaiDateShortYear(dateStr) {
      if (!dateStr) return "-";
      try {
        const date = new Date(dateStr);
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = (date.getFullYear() + 543).toString().slice(-2);
        return `${day}/${month}/${year}`;
      } catch (e) {
        console.error("Date formatting error:", e);
        return "-";
      }
    },
    
    // 4.4 Format Thai Date Full Year
    formatThaiDateFullYear(dateStr) {
      if (!dateStr) return "-";
      try {
        const date = new Date(dateStr);
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear() + 543;
        return `${day}/${month}/${year}`;
      } catch (e) {
        console.error("Date formatting error:", e);
        return "-";
      }
    },
    
    // 4.5 Format Thai Timestamp
    formatThaiTimestamp(date) {
      if (!(date instanceof Date)) date = new Date(date);
      if (isNaN(date)) return "-";
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear() + 543;
      const dateString = `${day}/${month}/${year}`;
      const timeString = date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
      return `วันที่ ${dateString} เวลา ${timeString} น.`;
    },
    
    // 4.6 Hash Password
    hash(pwd) {
      try {
        if (typeof CryptoJS !== 'undefined') return CryptoJS.SHA256(pwd).toString();
      } catch (e) {
        console.warn("CryptoJS not available, using simple hash");
      }
      let hash = 0;
      for (let i = 0; i < pwd.length; i++) {
        const char = pwd.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString();
    },
    
    // 4.7 Verify Password
    verify(pwd, hash) {
      return this.hash(pwd) === hash;
    },
    
    // 4.8 Array Buffer to Base64
    arrayBufferToBase64(buffer) {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      return window.btoa(binary);
    },
    
    // 4.9 Base64 to Array Buffer
    base64ToArrayBuffer(base64) {
      const binary_string = window.atob(base64);
      const len = binary_string.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
      return bytes.buffer;
    },
    
 // 4.10 Derive Key
async deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
},

// =================================================================
// 4.11 Mark As Deleted (Hard Delete Version - ไม่เก็บ Tombstone)
// =================================================================
_markAsDeleted(id) {
    // 🔥 Hard Delete: ไม่เก็บ Tombstone
    // ข้อมูลจะถูกลบอย่างถาวร ไม่สามารถกู้คืนได้
    return;
},

    // =================================================================
    // 5. DATA PERSISTENCE & SYNC (Offline-First)
    // =================================================================
    
// 5.1 Save Local
    saveLocal() {
      try {
        localStorage.setItem("posData", JSON.stringify(this.data));
      } catch (e) {
        console.error("Local save failed", e);
      }
    },
    
    // 5.2 Save Data (with Cloud Sync)
    async saveData() {
      // บังคับให้เวลาอัปเดตเดินหน้าเสมอ แม้นาฬิกาเครื่องจะเพี้ยน
      this.data._meta.lastLocalUpdate = Math.max(Date.now(), (this.data._meta.lastLocalUpdate || 0) + 1);
      this.saveLocal();
      this.refreshCurrentPage();
      if (this.firebase?.db) {
        try {
          await this.pushToCloud();
        } catch (err) {
          console.warn("Cloud sync failed (will retry later):", err);
        }
      }
      return Promise.resolve();
    },

    // 5.2.1 Manual Sync (Smart Push & Pull)
    async manualSync() {
      this.showToast("🔄 กำลังตรวจสอบและผสานข้อมูล...", "warning");
      try {
        if (!this.firebase || !this.firebase.db) {
          this.showToast("❌ ไม่ได้เชื่อมต่อฐานข้อมูลคลาวด์", "error");
          return;
        }

        const result = await window.firebase_tools_getDoc(this.firebase.db, "pos", "data");
        
        if (result && result.exists && result.data) {
          const remoteData = result.data;
          // ผสานข้อมูลแบบอัจฉริยะ (เช็ครายชิ้น)
          const hasUnsynced = this.mergeFromCloud(remoteData);
          
          if (hasUnsynced || this.data._meta.lastLocalUpdate > remoteData._meta.lastLocalUpdate) {
            await this.pushToCloud();
            this.showToast("✅ ซิงค์และผสานข้อมูลล่าสุดสำเร็จ", "success");
          } else {
            this.showToast("✅ ข้อมูลตรงกันและเป็นปัจจุบันแล้ว", "success");
          }
        } else {
          await this.pushToCloud();
          this.showToast("✅ อัปโหลดข้อมูลเริ่มต้นขึ้นคลาวด์สำเร็จ", "success");
        }
      } catch (error) {
        console.error("Manual Sync Error:", error);
        this.showToast("❌ การซิงค์ล้มเหลว โปรดตรวจสอบอินเทอร์เน็ต", "error");
      }
    },
    
    // 5.3 Init Firebase and Sync
    async initFirebaseAndSync() {
      if (window._initFirebaseModule) {
        try {
          this.firebase = await window._initFirebaseModule();
          console.log("Firebase initialized");
          this.startRealtimeSync();
          await this.pullFromCloud();
        } catch (e) {
          console.warn("Firebase initialization failed, continuing offline:", e);
        }
      }
    },
    
    // 5.4 Pull From Cloud
    async pullFromCloud() {
      if (!this.firebase?.db) return;
      this._isInitialSync = true;
      try {
        const result = await window.firebase_tools_getDoc(this.firebase.db, "pos", "data");
        if (result && result.exists && result.data) {
          const remoteData = result.data;
          console.log("☁️ ดึงข้อมูลจาก Cloud สำเร็จ");
          const hasUnsynced = this.mergeFromCloud(remoteData);
          if (hasUnsynced) {
             await this.pushToCloud();
          }
        }
      } catch (e) {
        console.warn("Cannot load from Firebase:", e);
      } finally {
        this._isInitialSync = false;
      }
    },
    
// =================================================================
// 5.5 Merge From Cloud (Hard Delete Version)
// =================================================================
mergeFromCloud(remote) {
    if (!remote || !remote._meta) return false;

    console.log("🔄 กำลังผสานข้อมูลจาก Cloud แบบ Hard Delete...");
    let hasLocalUnsyncedChanges = false;

    const mergeArray = (localArr, remoteArr) => {
        const result = [];
        const localMap = new Map(localArr.map(i => [String(i.id), i]));
        const remoteMap = new Map(remoteArr.map(i => [String(i.id), i]));
        
        // ใช้ข้อมูลจาก Cloud เป็นหลัก
        remoteMap.forEach((remoteItem, id) => {
            result.push(remoteItem);
        });
        
        // ข้อมูลในเครื่องที่ Cloud ไม่มี ให้ถือว่าเป็นข้อมูลใหม่
        localMap.forEach((localItem, id) => {
            if (!remoteMap.has(id)) {
                result.push(localItem);
                hasLocalUnsyncedChanges = true;
            }
        });
        
        return result;
    };

    // ผสานทุกตารางข้อมูล (ไม่สนใจ Tombstone)
    this.data.sales = mergeArray(this.data.sales || [], remote.sales || []);
    this.data.stockIns = mergeArray(this.data.stockIns || [], remote.stockIns || []);
    this.data.stockOuts = mergeArray(this.data.stockOuts || [], remote.stockOuts || []);
    this.data.products = mergeArray(this.data.products || [], remote.products || []);
    this.data.stores = mergeArray(this.data.stores || [], remote.stores || []);
    this.data.users = mergeArray(this.data.users || [], remote.users || []);
    
    this.data.backupPassword = remote.backupPassword || this.data.backupPassword;
    if (remote.autoReport && remote._meta.lastLocalUpdate > this.data._meta.lastLocalUpdate) {
        this.data.autoReport = remote.autoReport;
    }

    this.data._meta.lastLocalUpdate = Math.max(this.data._meta.lastLocalUpdate, remote._meta.lastLocalUpdate);
    this.data._meta.lastCloudSync = Date.now();
    
    this.recalculateAllStock();
    this.saveLocal();
    this.refreshCurrentPage();
    
    return hasLocalUnsyncedChanges;
},
    
// =================================================================
// 5.6 Push To Cloud (Hard Delete Version - ไม่ส่ง Tombstone)
// =================================================================
async pushToCloud() {
    if (!this.firebase?.db) return;
    try {
        // บังคับให้เวลาอัปเดตเดินหน้าเสมอ
        this.data._meta.lastLocalUpdate = Math.max(Date.now(), (this.data._meta.lastLocalUpdate || 0) + 1);
        
        // สร้างสำเนาข้อมูลที่จะส่งขึ้น Cloud
        const dataToSync = JSON.parse(JSON.stringify(this.data));
        
        // 🔥 ลบ Tombstone ออกจากข้อมูลที่จะส่งขึ้น Cloud (Hard Delete)
        if (dataToSync._meta && dataToSync._meta.deleted) {
            delete dataToSync._meta.deleted;
        }
        
        await window.firebase_tools_setDoc(this.firebase.db, "pos", "data", dataToSync);
        this.data._meta.lastCloudSync = Date.now();
        this.saveLocal();
        console.log("📤 Push ข้อมูลขึ้น Cloud สำเร็จ (Hard Delete)");
    } catch (e) {
        console.warn("Failed to sync to Firestore:", e);
    }
},
    
    // 5.7 Start Realtime Sync
    startRealtimeSync() {
      if (!this.firebase || !this.firebase.db) return;
      if (this._unsubscribe) this._unsubscribe();
      this._unsubscribe = window.firebase_tools_onSnapshot(
        this.firebase.db, "pos", "data",
        (snapshot) => {
          if (snapshot && snapshot.data) {
            const remoteData = snapshot.data;
            if (remoteData._meta?.lastLocalUpdate > this.data._meta.lastLocalUpdate) {
              console.log("⚡ Received update from Cloud (Realtime)");
              const hasUnsynced = this.mergeFromCloud(remoteData);
              if (hasUnsynced) {
                 // หากเครื่องเรามีข้อมูลค้างอยู่ (ขายออฟไลน์ไว้) ให้ดันไปสมทบบนคลาวด์
                 this.pushToCloud();
              }
            }
          }
        }
      );
      console.log("🔗 เริ่มต้น Real-time Sync แล้ว");
    },
    
    // 5.8 Download JSON
    downloadJSON(dataObj, fileName) {
      try {
        const dataStr = JSON.stringify(dataObj, null, 2);
        const blob = new Blob([dataStr], { type: "application/json;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", fileName + ".json");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error("Download JSON failed:", error);
        this.showToast("เกิดข้อผิดพลาดในการสร้างไฟล์ดาวน์โหลด", "error");
      }
    },
    
    // 5.9 Manual Save To Browser
    manualSaveToBrowser() {
      // บังคับให้เวลาอัปเดตเดินหน้าเสมอ แม้นาฬิกาเครื่องจะเพี้ยน
      this.data._meta.lastLocalUpdate = Math.max(Date.now(), (this.data._meta.lastLocalUpdate || 0) + 1);
      this.saveLocal();
      this.showToast("📥 บันทึกข้อมูล Snapshot ลงเบราว์เซอร์สำเร็จ (LocalStorage)", "success");
    },
    // =================================================================
    // 6. ENCRYPTION & DECRYPTION (Backup System)
    // =================================================================
    
    // 6.1 Encrypt Data
    async encryptData(dataString, password) {
      try {
        if (typeof CryptoJS === 'undefined') throw new Error("ไม่พบห้องสมุด CryptoJS ในระบบ");
        const salt = CryptoJS.lib.WordArray.random(128/8);
        const key = CryptoJS.PBKDF2(password, salt, { keySize: 256/32, iterations: 1000 });
        const iv = CryptoJS.lib.WordArray.random(128/8);
        const encrypted = CryptoJS.AES.encrypt(dataString, key, { iv: iv, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC });
        return {
          isEncrypted: true,
          salt: salt.toString(CryptoJS.enc.Base64),
          iv: iv.toString(CryptoJS.enc.Base64),
          encryptedData: encrypted.toString()
        };
      } catch (e) {
        console.error("Encryption failed:", e);
        throw new Error("การเข้ารหัสผิดพลาด: " + e.message);
      }
    },
    
    // 6.2 Decrypt Data
    async decryptData(encryptedPayload, password) {
      try {
        if (typeof CryptoJS === 'undefined') throw new Error("ไม่พบห้องสมุด CryptoJS ในระบบ");
        const salt = CryptoJS.enc.Base64.parse(encryptedPayload.salt);
        const iv = CryptoJS.enc.Base64.parse(encryptedPayload.iv);
        const key = CryptoJS.PBKDF2(password, salt, { keySize: 256/32, iterations: 1000 });
        const decrypted = CryptoJS.AES.decrypt(encryptedPayload.encryptedData, key, { iv: iv, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC });
        const decryptedText = decrypted.toString(CryptoJS.enc.Utf8);
        if (!decryptedText) throw new Error("ข้อมูลว่างเปล่าหรือรหัสผ่านไม่ถูกต้อง");
        return decryptedText;
      } catch (e) {
        console.error("Decryption failed:", e);
        return null;
      }
    },
    
    // 6.3 Prompt Load From File
    async promptLoadFromFile(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target.result;
          let importedData = JSON.parse(content);
          let finalDataToMerge = null;
          if (importedData && (importedData.isEncrypted === true || (typeof importedData === "object" && importedData.encryptedData))) {
            let adminPassword = this.data.backupPassword;
            if (!adminPassword) {
              adminPassword = prompt("ไฟล์สำรองนี้ถูกเข้ารหัสไว้ กรุณากรอกรหัสผ่านเพื่อปลดล็อกไฟล์:");
              if (!adminPassword) {
                this.showToast("ยกเลิกการนำเข้าไฟล์", "error");
                return;
              }
            }
            this.showToast("กำลังถอดรหัสไฟล์สำรอง...", "warning");
            const decryptedString = await this.decryptData(importedData, adminPassword);
            if (decryptedString) {
              try {
                finalDataToMerge = JSON.parse(decryptedString);
                this.showToast("🔓 ถอดรหัสและอ่านข้อมูลสำเร็จ!", "success");
              } catch (parseError) {
                this.showToast("ไฟล์สำรองเสียหายหรือโครงสร้างภายในไม่สมบูรณ์", "error");
                return;
              }
            } else {
              this.showToast("❌ รหัสผ่านไม่ถูกต้อง! ถอดรหัสไฟล์ล้มเหลว", "error");
              alert("รหัสผ่านที่ป้อนหรือที่บันทึกไว้ในระบบ ไม่ตรงกับรหัสผ่านที่ใช้เข้ารหัสไฟล์นี้ โปรดตรวจสอบแล้วลองอีกครั้ง");
              return;
            }
          } else {
            finalDataToMerge = importedData;
          }
          if (finalDataToMerge && typeof finalDataToMerge === "object" && ("users" in finalDataToMerge || "sales" in finalDataToMerge || "products" in finalDataToMerge)) {
            const confirmationMessage = "คุณต้องการรวมข้อมูลจากไฟล์สำรองนี้เข้ากับระบบปัจจุบันหรือไม่?\n\n- ข้อมูลชิ้นที่ซ้ำกันจะถูกปรับเปลี่ยนเป็นข้อมูลจากไฟล์สำรอง\n- ประวัติชิ้นใหม่จะถูกระดมเพิ่มเข้าไป\n- ระบบจะคำนวณยอดสต็อกสินค้าปัจจุบันใหม่ทั้งหมดให้อัตโนมัติ\n\nยืนยันการทำรายการ?";
            if (confirm(confirmationMessage)) {
              this.mergeData(finalDataToMerge);
              this.recalculateAllStock();
              this.showToast("กำลังบันทึกข้อมูลและซิงค์ Cloud... ห้ามปิดหน้าต่างนี้", "warning");
              await this.saveData();
              this.showToast("✓ นำเข้าข้อมูลและจัดสต็อกใหม่สำเร็จ!", "success");
              setTimeout(() => location.reload(), 1500);
            }
          } else {
            throw new Error("ไฟล์ที่คุณเลือกไม่ใช่รูปแบบฐานข้อมูลของระบบบัญชีขาย POS นี้");
          }
        } catch (error) {
          this.showToast("เกิดข้อผิดพลาด: " + error.message, "error");
          console.error(error);
        } finally {
          event.target.value = "";
        }
      };
      reader.onerror = () => this.showToast("ไม่สามารถอ่านไฟล์ผ่านระบบเบราว์เซอร์ได้", "error");
      reader.readAsText(file, "UTF-8");
    },

    // =================================================================
    // 7. BACKUP & RESTORE MANAGEMENT
    // =================================================================
    
    // 7.1 Save Backup Password
    saveBackupPassword(e) {
      e.preventDefault();
      const newPassword = document.getElementById("backup-password").value;
      const confirmPassword = document.getElementById("backup-password-confirm").value;
      if (newPassword !== confirmPassword) {
        this.showToast("รหัสผ่านไม่ตรงกัน กรุณากรอกใหม่อีกครั้ง", "error");
        return;
      }
      this.data.backupPassword = newPassword.trim() || null;
      this.saveData();
      this.showToast("บันทึกรหัสผ่านสำหรับไฟล์สำรองเรียบร้อยแล้ว");
      document.getElementById("backup-password").value = "";
      document.getElementById("backup-password-confirm").value = "";
      this.renderBackupPasswordStatus();
    },
    
    // 7.2 Render Backup Password Status
    renderBackupPasswordStatus() {
      const statusEl = document.getElementById("password-status");
      if (!statusEl) return;
      if (this.data.backupPassword) {
        statusEl.textContent = "สถานะ: มีการตั้งรหัสผ่านแล้ว";
        statusEl.style.color = "var(--success-color)";
      } else {
        statusEl.textContent = "สถานะ: ยังไม่มีการตั้งรหัสผ่าน (ไฟล์สำรองของแอดมินจะไม่ถูกเข้ารหัส)";
        statusEl.style.color = "var(--warning-color)";
      }
    },
    
// 7.3 Save Backup To File
    async saveBackupToFile() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const timeStr = `${year}${month}${day}${hours}${minutes}${seconds}`;
      
      const currentUser = this.currentUser.username;
      const fullFileName = `บันทึกรายการขาย${currentUser}_${timeStr}.json`;
      
      let dataToSaveString;
      const backupPassword = this.data.backupPassword;
      
      if (backupPassword) {
        try {
          this.showToast("กำลังเข้ารหัสข้อมูลด้วยรหัสผ่านของระบบ...", "warning");
          const originalDataString = JSON.stringify(this.data, null, 2);
          const encryptedObject = await this.encryptData(originalDataString, backupPassword);
          dataToSaveString = JSON.stringify(encryptedObject, null, 2);
          this.showToast("เข้ารหัสข้อมูลสำเร็จ!", "success");
        } catch (error) {
          console.error("Encryption failed:", error);
          this.showToast("เกิดข้อผิดพลาดในการเข้ารหัสข้อมูล", "error");
          return;
        }
      } else {
        this.showToast("บันทึกข้อมูลแบบไม่เข้ารหัส เนื่องจากแอดมินยังไม่ได้ตั้งรหัสผ่านของระบบ", "warning");
        dataToSaveString = JSON.stringify(this.data, null, 2);
      }
      const blob = new Blob([dataToSaveString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fullFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showToast(`บันทึกไฟล์ "${fullFileName}" เรียบร้อย`);
    },    
    // 7.4 Show Export Options Modal
    showExportOptionsModal() {
      const modal = document.getElementById('exportOptionsModal');
      if (modal) modal.style.display = 'flex';
    },
    
    // 7.5 Close Export Options Modal
    closeExportOptionsModal() {
      const modal = document.getElementById('exportOptionsModal');
      if (modal) modal.style.display = 'none';
    },
    
   // 7.6 Export Full Backup
    async exportFullBackup() {
      this.closeExportOptionsModal();
      const backupData = {
        users: this.data.users || [],
        products: this.data.products || [],
        sales: this.data.sales || [],
        stockIns: this.data.stockIns || [],
        stockOuts: this.data.stockOuts || [],
        stores: this.data.stores || [],
        backupPassword: this.data.backupPassword,
        _meta: this.data._meta,
        appName: 'POS บัญชีขาย',
        backupType: 'full',
        backupDate: new Date().toISOString()
      };
      const password = this.data.backupPassword;
      
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const timeStr = `${year}${month}${day}${hours}${minutes}${seconds}`;

      if (password && typeof this.encryptData === 'function') {
        try {
          this.showToast('กำลังเข้ารหัสข้อมูล กรุณารอสักครู่...', 'warning');
          const encryptedData = await this.encryptData(JSON.stringify(backupData), password);
          this.downloadJSON(encryptedData, `backup_full_encrypted_${timeStr}`);
          this.showToast('เข้ารหัสและบันทึกไฟล์สำเร็จ', 'success');
        } catch (error) {
          alert("เกิดข้อผิดพลาดในการเข้ารหัสข้อมูล: " + error.message);
        }
      } else {
        this.downloadJSON(backupData, `backup_full_${timeStr}`);
        this.showToast('บันทึกไฟล์สำเร็จ', 'success');
      }
    },
   // 7.7 Export Account Backup
    async exportAccountBackup() {
      this.closeExportOptionsModal();
      const allPersons = this.data.users || [];
      if (allPersons.length === 0) {
        alert('ไม่พบข้อมูลบัญชีผู้ใช้');
        return;
      }
      let selectedPersonId = '';
      let selectedPersonName = '';
      if (allPersons.length === 1) {
        selectedPersonId = allPersons[0].id;
        selectedPersonName = allPersons[0].username;
      } else {
        let personList = allPersons.map((p, i) => `${i + 1}. ${p.username} (${p.role})`).join('\n');
        const choice = prompt(`เลือกบัญชีที่ต้องการสำรองข้อมูล (พิมพ์ตัวเลข 1-${allPersons.length}):\n${personList}`);
        if (!choice) return;
        const index = parseInt(choice) - 1;
        if (isNaN(index) || index < 0 || index >= allPersons.length) {
          alert('เลือกไม่ถูกต้อง');
          return;
        }
        selectedPersonId = allPersons[index].id;
        selectedPersonName = allPersons[index].username;
      }
      const accountSales = (this.data.sales || []).filter(a => a.sellerId == selectedPersonId);
      const backupData = {
        users: allPersons,
        products: this.data.products || [],
        sales: accountSales,
        stockIns: this.data.stockIns || [],
        stockOuts: this.data.stockOuts || [],
        stores: this.data.stores || [],
        backupPassword: this.data.backupPassword,
        _meta: this.data._meta,
        appName: 'POS บัญชีขาย',
        backupType: 'account',
        accountName: selectedPersonName,
        backupDate: new Date().toISOString()
      };
      const password = this.data.backupPassword;
      
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const timeStr = `${year}${month}${day}${hours}${minutes}${seconds}`;
      
      const fileNameBase = `backup_account_${selectedPersonName}_${timeStr}`;
      
      if (password && typeof this.encryptData === 'function') {
        try {
          this.showToast('กำลังเข้ารหัสข้อมูล กรุณารอสักครู่...', 'warning');
          const encryptedData = await this.encryptData(JSON.stringify(backupData), password);
          this.downloadJSON(encryptedData, fileNameBase + "_encrypted");
          this.showToast('บันทึกไฟล์สำเร็จ', 'success');
        } catch (error) {
          alert("เกิดข้อผิดพลาด: " + error.message);
        }
      } else {
        this.downloadJSON(backupData, fileNameBase);
        this.showToast('บันทึกไฟล์สำเร็จ', 'success');
      }
    },    
    // 7.8 Show Single Date Export Modal
    showSingleDateExportModal() {
      this.closeExportOptionsModal();
      const allPersons = this.data.users || [];
      let displayAccount = "รวมทุกบัญชี";
      if (allPersons.length === 1) displayAccount = allPersons[0].username;
      const accElement = document.getElementById('singleDateAccountName');
      if (accElement) accElement.textContent = displayAccount;
      const startDateInput = document.getElementById('exportStartDate');
      const endDateInput = document.getElementById('exportEndDate');
      if (startDateInput) startDateInput.value = new Date().toISOString().split('T')[0];
      if (endDateInput) endDateInput.value = new Date().toISOString().split('T')[0];
      const modal = document.getElementById('singleDateExportModal');
      if (modal) modal.style.display = 'flex';
    },
    
    // 7.9 Close Single Date Export Modal
    closeSingleDateExportModal() {
      const modal = document.getElementById('singleDateExportModal');
      if (modal) modal.style.display = 'none';
    },
    
// 7.10 Process Date Range Export
    processDateRangeExport() {
      const startDate = document.getElementById('exportStartDate')?.value;
      const endDate = document.getElementById('exportEndDate')?.value;
      const includeCarryForwardCheckbox = document.getElementById('exportIncludeCarryForward');
      const includeCarryForward = includeCarryForwardCheckbox ? includeCarryForwardCheckbox.checked : false;

      if (!startDate || !endDate) {
        alert("กรุณาเลือกช่วงวันที่ให้ครบถ้วน");
        return;
      }
      if (startDate > endDate) {
        alert("วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด");
        return;
      }

      // ดึงข้อมูลทั้งหมด
      const allSales = this.data.sales || [];
      const allStockIns = this.data.stockIns || [];
      const allStockOuts = this.data.stockOuts || [];

      // 1. คัดกรองรายการที่อยู่ในช่วงเวลาที่กำหนด
      const filteredSales = allSales.filter(sale => {
        const d = sale.date ? sale.date.split('T')[0] : '';
        return d >= startDate && d <= endDate;
      });
      const filteredStockIns = allStockIns.filter(si => {
        const d = si.date ? si.date.split('T')[0] : '';
        return d >= startDate && d <= endDate;
      });
      const filteredStockOuts = allStockOuts.filter(so => {
        const d = so.date ? so.date.split('T')[0] : '';
        return d >= startDate && d <= endDate;
      });

      let carryForwardData = { totalSales: 0, totalProfit: 0, bySeller: {} };
      let carryForwardStockIns = []; // ตัวแปรเก็บรายการ "ยอดยกมา"

      if (includeCarryForward) {
        // 2. คำนวณยอดขายและกำไรยกมา (ก่อน startDate)
        const priorSales = allSales.filter(sale => {
          const d = sale.date ? sale.date.split('T')[0] : '';
          return d < startDate;
        });

        priorSales.forEach(sale => {
          carryForwardData.totalSales += sale.total;
          carryForwardData.totalProfit += sale.profit;
          const sellerId = sale.sellerId || 'unknown';
          if (!carryForwardData.bySeller[sellerId]) carryForwardData.bySeller[sellerId] = { sales: 0, profit: 0 };
          carryForwardData.bySeller[sellerId].sales += sale.total;
          carryForwardData.bySeller[sellerId].profit += sale.profit;
        });

        // 3. คำนวณสต็อกยกมา (ก่อน startDate) แบบชิ้นต่อชิ้น
        const priorStockIns = allStockIns.filter(si => (si.date ? si.date.split('T')[0] : '') < startDate);
        const priorStockOuts = allStockOuts.filter(so => (so.date ? so.date.split('T')[0] : '') < startDate);
        const priorStockMap = new Map();

        // 3.1 บวกยอดนำเข้าเดิม (แปลง ID เป็น String ป้องกัน Type mismatch)
        priorStockIns.forEach(si => {
          const pId = String(si.productId);
          const current = priorStockMap.get(pId) || { qty: 0, cost: si.costPerUnit };
          priorStockMap.set(pId, { qty: current.qty + si.quantity, cost: si.costPerUnit });
        });
        
        // 3.2 ลบด้วยยอดขายเดิม
        priorSales.forEach(sale => {
          sale.items.forEach(item => {
            const pId = String(item.productId);
            // กรณีไม่มีสต็อกมาก่อนแต่มีการขาย ให้ตั้งค่าเริ่มต้นเป็น 0 แล้วลบยอดออก (ยอดติดลบ)
            const current = priorStockMap.get(pId) || { qty: 0, cost: item.cost };
            current.qty -= item.quantity;
            priorStockMap.set(pId, current);
          });
        });
        
        // 3.3 ลบด้วยยอดปรับออกเดิม
        priorStockOuts.forEach(so => {
          const pId = String(so.productId);
          const current = priorStockMap.get(pId) || { qty: 0, cost: 0 };
          current.qty -= so.quantity;
          priorStockMap.set(pId, current);
        });

        // 4. สร้าง Record "ยอดยกมา" จำลองเข้าไปในฐานข้อมูล StockIn ขาเข้า
        const virtualDate = new Date(startDate);
        virtualDate.setHours(0, 0, 0, 0);
        const virtualDateStr = virtualDate.toISOString();
        
        let counter = 0;
        priorStockMap.forEach((data, pId) => {
          if (data.qty !== 0) { // ถ้ายอดคงเหลือไม่เป็นศูนย์ (เป็นบวกหรือติดลบก็นำไปคำนวณหมด)
            const product = this.data.products.find(p => String(p.id) === pId);
            if (product) {
              carryForwardStockIns.push({
                id: Date.now() + counter++, // ป้องกัน ID ซ้ำ
                date: virtualDateStr,
                productId: product.id, // คืนค่า ID เป็นชนิดข้อมูลดั้งเดิม
                productName: `[ยอดยกมา] ${product.name}`,
                quantity: data.qty,
                costPerUnit: data.cost || product.costPrice || 0,
                reason: "ยอดยกมาจากรอบก่อนหน้า"
              });
            }
          }
        });
      }

      // เช็คว่ามีข้อมูลที่ต้องการบันทึกหรือไม่
      if (filteredSales.length === 0 && (!includeCarryForward || carryForwardStockIns.length === 0)) {
        alert(startDate === endDate ? `ไม่มีข้อมูลรายการในวันที่ ${this.formatDateForDisplay(startDate)}` : `ไม่มีข้อมูลรายการในช่วงวันที่ ${this.formatDateForDisplay(startDate)} ถึง ${this.formatDateForDisplay(endDate)}`);
        this.closeSingleDateExportModal();
        return;
      }

      // รวมรายการ "ยอดยกมา" เข้ากับ "รายการนำเข้าที่เกิดขึ้นจริงในช่วงเวลา"
      const finalStockIns = includeCarryForward ? [...carryForwardStockIns, ...filteredStockIns] : filteredStockIns;

      const defaultFileName = startDate === endDate ? `ข้อมูลยกยอดวันที่_${this.formatDateForDisplay(startDate)}` : `ข้อมูลยกยอดช่วง_${this.formatDateForDisplay(startDate)}_ถึง_${this.formatDateForDisplay(endDate)}`;
      let fileName = prompt("กรุณากรอกชื่อไฟล์สำหรับบันทึกข้อมูล (ไม่ต้องใส่นามสกุล):", defaultFileName);
      if (!fileName) {
        this.closeSingleDateExportModal();
        return;
      }

      const backupData = {
        users: this.data.users || [],
        products: this.data.products || [],
        sales: filteredSales,
        stockIns: finalStockIns,
        stockOuts: filteredStockOuts,
        stores: this.data.stores || [],
        backupPassword: this.data.backupPassword,
        _meta: this.data._meta,
        appName: 'POS บัญชีขาย',
        backupType: startDate === endDate ? 'single_date' : 'date_range',
        startDate: startDate,
        endDate: endDate,
        carryForward: includeCarryForward ? carryForwardData : null
      };

      this.handleDateRangeExportAs('json', fileName, backupData);
      this.closeSingleDateExportModal();
    },
    // 7.11 Handle Date Range Export As
    handleDateRangeExportAs(format, fileName, backupData) {
      if (format === 'json') {
        const password = this.data.backupPassword;
        if (password && typeof this.encryptData === 'function') {
          this.showToast('กำลังเข้ารหัสข้อมูล กรุณารอสักครู่...', 'warning');
          this.encryptData(JSON.stringify(backupData), password).then(encryptedData => {
            this.downloadJSON(encryptedData, fileName + "_encrypted");
            this.showToast('บันทึกไฟล์สำเร็จ', 'success');
          }).catch(err => {
            alert("เข้ารหัสล้มเหลว: " + err.message);
          });
        } else {
          this.downloadJSON(backupData, fileName);
          this.showToast('บันทึกไฟล์สำเร็จ', 'success');
        }
      }
    },
    
    // 7.12 Format Date For Display
    formatDateForDisplay(dateStr) {
      if (!dateStr) return '';
      try {
        const date = new Date(dateStr);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear() + 543;
        return `${day}/${month}/${year}`;
      } catch(e) {
        return dateStr;
      }
    },

    // =================================================================
    // 8. DATA MERGE & RESET FUNCTIONS
    // =================================================================
    
    // 8.1 Merge Single Array
    _mergeSingleArray(currentArray, newArray, key = "id") {
      if (!newArray || !Array.isArray(newArray)) return;
      const currentIds = new Set(currentArray.map((item) => item[key]));
      newArray.forEach((newItem) => {
        if (!newItem || typeof newItem[key] === "undefined") return;
        if (currentIds.has(newItem[key])) {
          const index = currentArray.findIndex((currentItem) => currentItem[key] === newItem[key]);
          if (index > -1) currentArray[index] = newItem;
        } else {
          currentArray.push(newItem);
          currentIds.add(newItem[key]);
        }
      });
    },
    
    // 8.2 Merge Data
    mergeData(dataFromFile) {
      const importedUsers = dataFromFile.users || [];
      const importedStores = dataFromFile.stores || [];
      const importedSales = dataFromFile.sales || [];
      const importedStockIns = dataFromFile.stockIns || [];
      const importedStockOuts = dataFromFile.stockOuts || [];
      const importedProducts = dataFromFile.products || [];
      if (importedUsers.length > 0) {
        const currentAdmin = this.data.users.find((u) => u.username === "admin");
        const importedAdmin = importedUsers.find((u) => u.username === "admin");
        if (currentAdmin && importedAdmin) {
          currentAdmin.password = importedAdmin.password;
          if (importedAdmin.passwordHash) currentAdmin.passwordHash = importedAdmin.passwordHash;
        }
        const importedSellers = importedUsers.filter((u) => u.role !== "admin");
        this._mergeSingleArray(this.data.users, importedSellers, "id");
      }
      if (importedStores.length > 0) this._mergeSingleArray(this.data.stores, importedStores, "id");
      if (importedSales.length > 0) this._mergeSingleArray(this.data.sales, importedSales, "id");
      if (importedStockIns.length > 0) this._mergeSingleArray(this.data.stockIns, importedStockIns, "id");
      if (importedStockOuts.length > 0) this._mergeSingleArray(this.data.stockOuts, importedStockOuts, "id");
      if (importedProducts.length > 0) {
        importedProducts.forEach((newProduct) => {
          if (!newProduct || typeof newProduct.id === "undefined") return;
          const existingProduct = this.data.products.find((p) => p.id === newProduct.id);
          if (existingProduct) {
            existingProduct.name = newProduct.name;
            existingProduct.costPrice = newProduct.costPrice;
            existingProduct.sellingPrice = newProduct.sellingPrice;
            existingProduct.unit = newProduct.unit;
          } else {
            this.data.products.push(newProduct);
          }
        });
      }
    },
    
// 8.3 Open Reset Modal
    openResetModal() {
      if(document.getElementById("reset-sales-checkbox")) document.getElementById("reset-sales-checkbox").checked = false;
      if(document.getElementById("reset-stockins-checkbox")) document.getElementById("reset-stockins-checkbox").checked = false;
      if(document.getElementById("reset-stockouts-checkbox")) document.getElementById("reset-stockouts-checkbox").checked = false;
      if(document.getElementById("reset-products-checkbox")) document.getElementById("reset-products-checkbox").checked = false;
      if(document.getElementById("reset-sellers-checkbox")) document.getElementById("reset-sellers-checkbox").checked = false;
      if(document.getElementById("reset-stores-checkbox")) document.getElementById("reset-stores-checkbox").checked = false;
      document.getElementById("resetModal").style.display = "flex";
    },
    
    // 8.4 Close Reset Modal
    closeResetModal() {
      document.getElementById("resetModal").style.display = "none";
    },
    
// =================================================================
// 8.5 Handle Selective Reset (Hard Delete Version - ลบ Tombstone ด้วย)
// =================================================================
handleSelectiveReset() {
    const resetSales = document.getElementById("reset-sales-checkbox")?.checked;
    const resetStockIns = document.getElementById("reset-stockins-checkbox")?.checked;
    const resetStockOuts = document.getElementById("reset-stockouts-checkbox")?.checked;
    const resetProducts = document.getElementById("reset-products-checkbox")?.checked;
    const resetSellers = document.getElementById("reset-sellers-checkbox")?.checked;
    const resetStores = document.getElementById("reset-stores-checkbox")?.checked;

    if (!resetSales && !resetStockIns && !resetStockOuts && !resetProducts && !resetSellers && !resetStores) {
        this.showToast("กรุณาเลือกส่วนที่ต้องการรีเซ็ตอย่างน้อย 1 ส่วน", "warning");
        return;
    }
    
    if (confirm("🚨 คำเตือนวิกฤต: คุณแน่ใจหรือไม่ที่จะล้างข้อมูลส่วนที่เลือก? การกระทำนี้ไม่สามารถย้อนกลับได้!")) {
        // 🔥 เก็บ ID ของข้อมูลที่จะลบ เพื่อใช้ลบ Tombstone
        const deletedIds = [];
        
        if (resetSales) {
            this.data.sales.forEach(s => {
                this._markAsDeleted(s.id);
                deletedIds.push(String(s.id));
            });
            this.data.sales = [];
        }
        if (resetStockIns) {
            this.data.stockIns.forEach(s => {
                this._markAsDeleted(s.id);
                deletedIds.push(String(s.id));
            });
            this.data.stockIns = [];
        }
        if (resetStockOuts) {
            this.data.stockOuts.forEach(s => {
                this._markAsDeleted(s.id);
                deletedIds.push(String(s.id));
            });
            this.data.stockOuts = [];
        }
        if (resetProducts) {
            this.data.products.forEach(p => {
                this._markAsDeleted(p.id);
                deletedIds.push(String(p.id));
            });
            this.data.products = [];
        }
        if (resetStores) {
            this.data.stores.forEach(s => {
                this._markAsDeleted(s.id);
                deletedIds.push(String(s.id));
            });
            this.data.stores = [];
        }
        if (resetSellers) {
            this.data.users.forEach(u => {
                if (u.role !== "admin" && u.id !== "static-admin-id-001") {
                    this._markAsDeleted(u.id);
                    deletedIds.push(String(u.id));
                }
            });
            this.data.users = this.data.users.filter(u => u.role === "admin" || u.id === "static-admin-id-001");
        }
        
        // 🔥 ลบ Tombstone ของข้อมูลที่ถูกลบทั้งหมด
        if (this.data._meta && this.data._meta.deleted) {
            deletedIds.forEach(id => {
                if (this.data._meta.deleted[id]) {
                    delete this.data._meta.deleted[id];
                }
            });
            
            // ถ้าไม่มี Tombstone เหลือเลย ให้ลบ Object ทั้งหมด
            if (Object.keys(this.data._meta.deleted).length === 0) {
                delete this.data._meta.deleted;
            }
        }
        
        this.recalculateAllStock();
        this.saveData();
        this.closeResetModal();
        this.showToast("🔥 รีเซ็ตข้อมูลที่เลือกและลบ Tombstone เรียบร้อย", "success");
        setTimeout(() => location.reload(), 1000);
    }
},
// =================================================================
// 8.6 Clear All Tombstones (Hard Reset - ลบ Tombstone ทั้งหมด)
// =================================================================
clearAllTombstones() {
    if (this.data._meta && this.data._meta.deleted) {
        const count = Object.keys(this.data._meta.deleted).length;
        if (count === 0) {
            this.showToast("ไม่มี Tombstone ในระบบ", "info");
            return;
        }
        
        if (confirm(`🚨 คุณต้องการลบ Tombstone ทั้งหมด ${count} รายการใช่หรือไม่?\n\n⚠️ คำเตือน: การลบ Tombstone จะทำให้ข้อมูลที่ถูกลบไปแล้วไม่สามารถป้องกันการคืนกลับมาอีกได้`)) {
            delete this.data._meta.deleted;
            this.saveData();
            this.showToast(`✅ ลบ Tombstone ทั้งหมด ${count} รายการเรียบร้อย`, "success");
        }
    } else {
        this.showToast("ไม่พบ Tombstone ในระบบ", "info");
    }
},
    // =================================================================
    // 9. STOCK MANAGEMENT
    // =================================================================
    
// 9.1 Recalculate All Stock
    recalculateAllStock() {
      const totalStockIn = new Map();
      const totalSold = new Map();
      const totalStockOut = new Map();
      
      this.data.stockIns.forEach((si) => {
        const pId = String(si.productId);
        const currentQty = totalStockIn.get(pId) || 0;
        totalStockIn.set(pId, currentQty + si.quantity);
      });
      
      this.data.sales.forEach((sale) => {
        sale.items.forEach((item) => {
          const pId = String(item.productId);
          const currentQty = totalSold.get(pId) || 0;
          totalSold.set(pId, currentQty + item.quantity);
        });
      });
      
      this.data.stockOuts.forEach((so) => {
        const pId = String(so.productId);
        const currentQty = totalStockOut.get(pId) || 0;
        totalStockOut.set(pId, currentQty + so.quantity);
      });
      
      this.data.products.forEach((product) => {
        const pId = String(product.id);
        const initialStock = totalStockIn.get(pId) || 0;
        const soldQty = totalSold.get(pId) || 0;
        const stockOutQty = totalStockOut.get(pId) || 0;
        product.stock = initialStock - soldQty - stockOutQty;
      });
      
      console.log("Stock recalculated for all products based on history.");
    },
    
    // 9.2 Handle Recalculate Stock
    handleRecalculateStock() {
      if (confirm('คุณแน่ใจหรือไม่ว่าต้องการ "คำนวณสต็อกใหม่ทั้งหมด" ? การกระทำนี้จะใช้ประวัติการนำเข้า/ขาย/ปรับออกทั้งหมด เพื่อกำหนดค่าสต็อกสินค้าปัจจุบันใหม่')) {
        this.recalculateAllStock();
        this.saveData();
        this.showToast("คำนวณสต็อกใหม่ทั้งหมดสำเร็จ!");
        this.renderStockSummaryReport();
      }
    },
    
    // 9.3 Calculate Stock As Of
    calculateStockAsOf(cutoffDate) {
      const stockSummary = [];
      this.data.products.forEach((product) => {
        const totalStockIn = this.data.stockIns.filter(si => si.productId === product.id && new Date(si.date) <= cutoffDate).reduce((sum, si) => sum + si.quantity, 0);
        const totalSold = this.data.sales.filter(sale => new Date(sale.date) <= cutoffDate).flatMap(sale => sale.items).filter(item => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
        const totalStockOut = this.data.stockOuts.filter(so => so.productId === product.id && new Date(so.date) <= cutoffDate).reduce((sum, so) => sum + so.quantity, 0);
        const calculatedStock = totalStockIn - totalSold - totalStockOut;
        stockSummary.push({ id: product.id, name: product.name, unit: product.unit, stock: calculatedStock });
      });
      return stockSummary;
    },
    
    // 9.4 Render Stock In
    renderStockIn() {
      const productSelect = document.getElementById("stock-in-product");
      if (this.editingStockInId === null) {
        document.getElementById("stock-in-form").reset();
        const now = new Date();
        document.getElementById("stock-in-date").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        document.getElementById("stock-in-time").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      }
      productSelect.innerHTML = '<option value="">--- เลือกสินค้า ---</option>';
      this.data.products.forEach((p) => {
        productSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
      });
      const historyTbody = document.querySelector("#stock-in-history-table tbody");
      historyTbody.innerHTML = "";
      [...this.data.stockIns].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((si) => {
        const tr = document.createElement("tr");
        const stockInDate = new Date(si.date);
        const dateString = this.formatThaiDateShortYear(si.date);
        const timeString = `${String(stockInDate.getHours()).padStart(2, "0")}.${String(stockInDate.getMinutes()).padStart(2, "0")} น.`;
        tr.innerHTML = `
          <td data-label="วันที่">${dateString}</td>
          <td data-label="เวลา">${timeString}</td>
          <td data-label="สินค้า">${si.productName}</td>
          <td data-label="จำนวน">${this.formatNumberSmart(si.quantity)}</td>
          <td data-label="ทุนต่อหน่วย">${this.formatNumberSmart(si.costPerUnit)}</td>
          <td data-label="ยอดรวม">${this.formatNumberSmart(si.quantity * si.costPerUnit)}</td>
          <td data-label="จัดการ"><div class="action-buttons"><button class="edit-stock-in-btn" data-id="${si.id}" style="background-color: var(--warning-color);">แก้ไข</button><button class="danger delete-stock-in-btn" data-id="${si.id}">ลบ</button></div></td>`;
        historyTbody.appendChild(tr);
      });
    },
    
    // 9.5 Save Stock In
    saveStockIn(e) {
      e.preventDefault();
      const form = document.getElementById("stock-in-form");
      const productId = document.getElementById("stock-in-product").value;
      const newQuantity = parseInt(document.getElementById("stock-in-quantity").value);
      const newCostPrice = parseFloat(document.getElementById("stock-in-cost").value);
      const newSellingPrice = parseFloat(document.getElementById("stock-in-price").value);
      if (!productId) {
        this.showToast("กรุณาเลือกสินค้า", "error");
        return;
      }
      if (isNaN(newQuantity) || newQuantity <= 0) {
        this.showToast("กรุณากรอกจำนวนให้ถูกต้อง", "error");
        return;
      }
      if (isNaN(newCostPrice) || newCostPrice < 0) {
        this.showToast("กรุณากรอกราคาทุนให้ถูกต้อง", "error");
        return;
      }
      if (isNaN(newSellingPrice) || newSellingPrice < 0) {
        this.showToast("กรุณากรอกราคาขายให้ถูกต้อง", "error");
        return;
      }
      const product = this.data.products.find((p) => p.id == productId);
      if (!product) {
        this.showToast("ไม่พบสินค้า", "error");
        return;
      }
      let recordDate = new Date();
      const dateInput = document.getElementById("stock-in-date").value;
      const timeInput = document.getElementById("stock-in-time").value;
      if (dateInput) {
        const [year, month, day] = dateInput.split("-");
        recordDate.setFullYear(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
      if (timeInput) {
        const [hours, minutes] = timeInput.split(":");
        recordDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      }
      const finalDateISO = recordDate.toISOString();
      if (this.editingStockInId) {
        const targetId = parseInt(this.editingStockInId, 10);
        const stockInRecord = this.data.stockIns.find((si) => si.id === targetId);
        if (!stockInRecord) {
          this.showToast("ไม่พบรายการนำเข้าที่จะแก้ไข", "error");
          this.clearStockInForm();
          return;
        }
        const oldQuantity = stockInRecord.quantity;
        const quantityDifference = newQuantity - oldQuantity;
        product.stock += quantityDifference;
        product.costPrice = newCostPrice;
        product.sellingPrice = newSellingPrice;
        stockInRecord.quantity = newQuantity;
        stockInRecord.costPerUnit = newCostPrice;
        stockInRecord.productName = product.name;
        stockInRecord.date = finalDateISO;
        this.showToast(`แก้ไขรายการนำเข้าของ ${product.name} สำเร็จ`);
      } else {
        product.stock += newQuantity;
        product.costPrice = newCostPrice;
        product.sellingPrice = newSellingPrice;
        const stockInRecord = { id: Date.now(), date: finalDateISO, productId: product.id, productName: product.name, quantity: newQuantity, costPerUnit: newCostPrice };
        this.data.stockIns.push(stockInRecord);
        this.showToast(`นำเข้า ${product.name} สำเร็จ`);
      }
      this.saveData();
      this.clearStockInForm();
      this.renderStockIn();
    },
    
    // 9.6 Edit Stock In
    editStockIn(id) {
      const targetId = parseInt(id, 10);
      const stockInRecord = this.data.stockIns.find((si) => si.id === targetId);
      if (stockInRecord) {
        const product = this.data.products.find((p) => p.id === stockInRecord.productId);
        if (!product) {
          this.showToast("ไม่พบสินค้าที่เกี่ยวข้องกับรายการนี้", "error");
          return;
        }
        this.editingStockInId = targetId;
        const form = document.getElementById("stock-in-form");
        document.getElementById("stock-in-product").value = stockInRecord.productId;
        document.getElementById("stock-in-quantity").value = stockInRecord.quantity;
        document.getElementById("stock-in-cost").value = stockInRecord.costPerUnit;
        document.getElementById("stock-in-price").value = product.sellingPrice;
        const recordDate = new Date(stockInRecord.date);
        document.getElementById("stock-in-date").value = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, "0")}-${String(recordDate.getDate()).padStart(2, "0")}`;
        document.getElementById("stock-in-time").value = `${String(recordDate.getHours()).padStart(2, "0")}:${String(recordDate.getMinutes()).padStart(2, "0")}`;
        document.getElementById("stock-in-product").disabled = true;
        this.showToast(`กำลังแก้ไขการนำเข้าของ: ${stockInRecord.productName}`, "warning");
        form.scrollIntoView({ behavior: "smooth" });
      }
    },
    
    // 9.7 Clear Stock In Form
    clearStockInForm() {
      this.editingStockInId = null;
      const form = document.getElementById("stock-in-form");
      form.reset();
      document.getElementById("stock-in-product").disabled = false;
      const now = new Date();
      document.getElementById("stock-in-date").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      document.getElementById("stock-in-time").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    },
    
// 9.8 Delete Stock In
    deleteStockIn(id) {
      if (!confirm("คุณแน่ใจว่าต้องการลบรายการนำเข้านี้? (ระบบจะหักสต็อกสินค้าตัวนี้คืน)")) return;
      const targetId = parseInt(id, 10);
      const index = this.data.stockIns.findIndex(si => si.id === targetId);
      if (index > -1) {
        this._markAsDeleted(targetId);
        const record = this.data.stockIns[index];
        const product = this.data.products.find(p => p.id === record.productId);
        if (product) product.stock -= record.quantity;
        this.data.stockIns.splice(index, 1);
        this.saveData();
        this.showToast("ลบรายการนำเข้าสินค้าเรียบร้อยแล้ว", "success");
        this.renderStockIn();
      } else {
        this.showToast("ไม่พบรายการนำเข้าที่ระบุ", "error");
      }
    },
    
    // 9.9 Render Stock Out
    renderStockOut() {
      const productSelect = document.getElementById("stock-out-product");
      if (this.editingStockOutId === null) {
        document.getElementById("stock-out-form").reset();
        const now = new Date();
        document.getElementById("stock-out-date").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        document.getElementById("stock-out-time").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      }
      productSelect.innerHTML = '<option value="">--- เลือกสินค้า ---</option>';
      this.data.products.forEach((p) => {
        productSelect.innerHTML += `<option value="${p.id}">${p.name} (คงเหลือ: ${this.formatNumberSmart(p.stock)})</option>`;
      });
      const historyTbody = document.querySelector("#stock-out-history-table tbody");
      historyTbody.innerHTML = "";
      [...this.data.stockOuts].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((so) => {
        const tr = document.createElement("tr");
        const stockOutDate = new Date(so.date);
        const dateString = this.formatThaiDateShortYear(so.date);
        const timeString = `${String(stockOutDate.getHours()).padStart(2, "0")}.${String(stockOutDate.getMinutes()).padStart(2, "0")} น.`;
        tr.innerHTML = `
          <td data-label="วันที่">${dateString}</td>
          <td data-label="เวลา">${timeString}</td>
          <td data-label="สินค้า">${so.productName}</td>
          <td data-label="จำนวน">${this.formatNumberSmart(so.quantity)}</td>
          <td data-label="เหตุผล">${so.reason}</td>
          <td data-label="จัดการ"><div class="action-buttons"><button class="edit-stock-out-btn" data-id="${so.id}" style="background-color: var(--warning-color);">แก้ไข</button><button class="danger delete-stock-out-btn" data-id="${so.id}">ลบ</button></div></td>`;
        historyTbody.appendChild(tr);
      });
    },
    
    // 9.10 Save Stock Out
    saveStockOut(e) {
      e.preventDefault();
      const productId = document.getElementById("stock-out-product").value;
      const newQuantity = parseInt(document.getElementById("stock-out-quantity").value);
      const newReason = document.getElementById("stock-out-reason").value.trim();
      const product = this.data.products.find((p) => p.id == productId);
      if (!product) {
        this.showToast("ไม่พบสินค้า", "error");
        return;
      }
      if (isNaN(newQuantity) || newQuantity <= 0) {
        this.showToast("กรุณากรอกจำนวนให้ถูกต้อง", "error");
        return;
      }
      if (!newReason) {
        this.showToast("กรุณาระบุเหตุผลในการนำออก", "error");
        return;
      }
      let recordDate = new Date();
      const dateInput = document.getElementById("stock-out-date").value;
      const timeInput = document.getElementById("stock-out-time").value;
      if (dateInput) {
        const [year, month, day] = dateInput.split("-");
        recordDate.setFullYear(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
      if (timeInput) {
        const [hours, minutes] = timeInput.split(":");
        recordDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      }
      const finalDateISO = recordDate.toISOString();
      if (this.editingStockOutId) {
        const targetId = parseInt(this.editingStockOutId, 10);
        const stockOutRecord = this.data.stockOuts.find((so) => so.id === targetId);
        if (!stockOutRecord) {
          this.showToast("ไม่พบรายการที่จะแก้ไข", "error");
          this.clearStockOutForm();
          return;
        }
        const oldQuantity = stockOutRecord.quantity;
        const quantityDifference = newQuantity - oldQuantity;
        if (quantityDifference > product.stock) {
          this.showToast("สต็อกไม่เพียงพอสำหรับการแก้ไขนี้", "error");
          return;
        }
        product.stock -= quantityDifference;
        stockOutRecord.quantity = newQuantity;
        stockOutRecord.reason = newReason;
        stockOutRecord.productName = product.name;
        stockOutRecord.date = finalDateISO;
        this.showToast(`แก้ไขรายการนำออกของ ${product.name} สำเร็จ`);
      } else {
        if (newQuantity > product.stock) {
          this.showToast("สินค้าในสต็อกไม่เพียงพอที่จะนำออก", "error");
          return;
        }
        product.stock -= newQuantity;
        const stockOutRecord = { id: Date.now(), date: finalDateISO, productId: product.id, productName: product.name, quantity: newQuantity, reason: newReason };
        this.data.stockOuts.push(stockOutRecord);
        this.showToast("บันทึกการนำออกสินค้าเรียบร้อย");
      }
      this.saveData();
      this.clearStockOutForm();
      this.renderStockOut();
    },
    
    // 9.11 Edit Stock Out
    editStockOut(id) {
      const targetId = parseInt(id, 10);
      const stockOutRecord = this.data.stockOuts.find((so) => so.id === targetId);
      if (stockOutRecord) {
        this.editingStockOutId = targetId;
        document.getElementById("stock-out-product").value = stockOutRecord.productId;
        document.getElementById("stock-out-quantity").value = stockOutRecord.quantity;
        document.getElementById("stock-out-reason").value = stockOutRecord.reason;
        const recordDate = new Date(stockOutRecord.date);
        document.getElementById("stock-out-date").value = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, "0")}-${String(recordDate.getDate()).padStart(2, "0")}`;
        document.getElementById("stock-out-time").value = `${String(recordDate.getHours()).padStart(2, "0")}:${String(recordDate.getMinutes()).padStart(2, "0")}`;
        document.getElementById("stock-out-product").disabled = true;
        document.getElementById("stock-out-form").scrollIntoView({ behavior: "smooth" });
        this.showToast(`กำลังแก้ไขการนำออกของ: ${stockOutRecord.productName}`, "warning");
      }
    },
    
    // 9.12 Clear Stock Out Form
    clearStockOutForm() {
      this.editingStockOutId = null;
      const form = document.getElementById("stock-out-form");
      form.reset();
      document.getElementById("stock-out-product").disabled = false;
      const now = new Date();
      document.getElementById("stock-out-date").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      document.getElementById("stock-out-time").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    },
    
// 9.13 Delete Stock Out
    deleteStockOut(id) {
      if (!confirm("คุณแน่ใจว่าต้องการลบรายการปรับยอดนี้? (ระบบจะบวกสต็อกสินค้าคืนให้)")) return;
      const targetId = parseInt(id, 10);
      const index = this.data.stockOuts.findIndex(so => so.id === targetId);
      if (index > -1) {
        this._markAsDeleted(targetId);
        const record = this.data.stockOuts[index];
        const product = this.data.products.find(p => p.id === record.productId);
        if (product) product.stock += record.quantity;
        this.data.stockOuts.splice(index, 1);
        this.saveData();
        this.showToast("ลบรายการปรับยอดสินค้าเรียบร้อยแล้ว", "success");
        this.renderStockOut();
      } else {
        this.showToast("ไม่พบรายการปรับยอดที่ระบุ", "error");
      }
    },
    
    // 9.14 Render Stock Summary Report
    renderStockSummaryReport() {
      const container = document.getElementById("stock-summary-report-container");
      if (!container) return;
      let tableHTML = `<div class="table-container"><table id="stock-summary-table"><thead><tr><th>สินค้า</th><th>นำเข้าทั้งหมด</th><th>ขายไปทั้งหมด</th><th>ปรับออก</th><th>สต็อก (คำนวณ)</th><th>สต็อก (ปัจจุบัน)</th><th>สถานะ</th></tr></thead><tbody>`;
      let hasDiscrepancy = false;
      this.data.products.forEach((product) => {
        const totalStockIn = this.data.stockIns.filter(si => si.productId === product.id).reduce((sum, si) => sum + si.quantity, 0);
        const totalSold = this.data.sales.flatMap(sale => sale.items).filter(item => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
        const totalStockOut = this.data.stockOuts.filter(so => so.productId === product.id).reduce((sum, so) => sum + so.quantity, 0);
        const calculatedStock = totalStockIn - totalSold - totalStockOut;
        const currentStock = product.stock;
        const isMatch = calculatedStock === currentStock;
        if (!isMatch) hasDiscrepancy = true;
        tableHTML += `<tr style="${!isMatch ? "background-color: #ffdddd; color: var(--danger-color); font-weight: bold;" : ""}">
          <td data-label="สินค้า">${product.name}</td>
          <td data-label="นำเข้าทั้งหมด">${this.formatNumberSmart(totalStockIn)} ${product.unit}</td>
          <td data-label="ขายไปทั้งหมด">${this.formatNumberSmart(totalSold)} ${product.unit}</td>
          <td data-label="ปรับออก">${this.formatNumberSmart(totalStockOut)} ${product.unit}</td>
          <td data-label="สต็อก (คำนวณ)">${this.formatNumberSmart(calculatedStock)} ${product.unit}</td>
          <td data-label="สต็อก (ปัจจุบัน)">${this.formatNumberSmart(currentStock)} ${product.unit}</td>
          <td data-label="สถานะ">${isMatch ? '<span style="color:green;">✓ ตรงกัน</span>' : "✗ ไม่ตรงกัน"}</td>
        </tr>`;
      });
      tableHTML += `</tbody></table></div>`;
      let summaryText = hasDiscrepancy ? `<p style="color: var(--danger-color); text-align: center; font-weight: bold;">ตรวจพบสต็อกไม่ตรงกัน! คุณสามารถกดปุ่ม "คำนวณสต็อกใหม่ทั้งหมด" เพื่อแก้ไข</p>` : `<p style="color: var(--success-color); text-align: center; font-weight: bold;">ยอดสต็อกทั้งหมดถูกต้อง</p>`;
      container.innerHTML = summaryText + tableHTML;
      this.showToast("สร้างรายงานสต็อกสำเร็จ");
    },
    
    // 9.15 Render Yesterday Stock Summary Report
    renderYesterdayStockSummaryReport() {
      const container = document.getElementById("stock-summary-report-container");
      if (!container) return;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 59, 59, 999);
      const stockData = this.calculateStockAsOf(yesterday);
      let tableHTML = `<h3 style="text-align:center;">รายงานสรุปสต็อก ณ สิ้นวันที่ ${this.formatThaiDateFullYear(yesterday)}</h3><div class="table-container"><table id="yesterday-stock-summary-table"><thead><tr><th>สินค้า</th><th>สต็อกคงเหลือ (ณ สิ้นวัน)</th></tr></thead><tbody>`;
      stockData.forEach((product) => {
        tableHTML += `<tr><td data-label="สินค้า">${product.name}</td><td data-label="สต็อกคงเหลือ">${this.formatNumberSmart(product.stock)} ${product.unit}</td></tr>`;
      });
      tableHTML += `</tbody></table></div>`;
      container.innerHTML = tableHTML;
      this.showToast("สร้างรายงานสต็อก ณ สิ้นวันก่อนหน้าสำเร็จ");
    },

    // =================================================================
    // 10. PRODUCT MANAGEMENT
    // =================================================================
    
    // 10.1 Render Product Table
    renderProductTable() {
      const tbody = document.querySelector("#product-table tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      this.data.products.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td data-label="ชื่อสินค้า">${p.name}</td><td data-label="สต็อก">${this.formatNumberSmart(p.stock)}</td><td data-label="หน่วย">${p.unit}</td><td data-label="จัดการ"><div class="action-buttons"><button class="edit-product-btn" data-id="${p.id}" style="background-color: var(--warning-color);">แก้ไข</button><button class="danger delete-product-btn" data-id="${p.id}">ลบ</button></div></td>`;
        tbody.appendChild(tr);
      });
    },
    
    // 10.2 Save Product
    saveProduct(e) {
      e.preventDefault();
      const idValue = document.getElementById("product-id").value;
      const id = idValue ? parseInt(idValue, 10) : null;
      const newProductData = { name: document.getElementById("product-name").value, unit: document.getElementById("product-unit").value };
      if (id) {
        const index = this.data.products.findIndex((p) => p.id === id);
        if (index > -1) {
          const oldProduct = this.data.products[index];
          const newName = newProductData.name;
          if (oldProduct.name !== newName) {
            this.data.sales.forEach((sale) => { sale.items.forEach((item) => { if (item.productId === id) item.name = newName; }); });
            this.data.stockIns.forEach((stockIn) => { if (stockIn.productId === id) stockIn.productName = newName; });
            this.data.stockOuts.forEach((stockOut) => { if (stockOut.productId === id) stockOut.productName = newName; });
            this.showToast("อัปเดตชื่อสินค้าในประวัติย้อนหลังเรียบร้อย");
          }
          this.data.products[index].name = newProductData.name;
          this.data.products[index].unit = newProductData.unit;
          this.data.products[index].updatedAt = Date.now();
        }
      } else {
        newProductData.id = Date.now();
        newProductData.stock = 0;
        newProductData.costPrice = 0;
        newProductData.sellingPrice = 0;
        newProductData.updatedAt = Date.now();
        this.data.products.push(newProductData);
      }
      this.saveData();
      this.renderProductTable();
      document.getElementById("product-form").reset();
      document.getElementById("product-id").value = "";
    },
    
    // 10.3 Edit Product
    editProduct(id) {
      const product = this.data.products.find((p) => p.id == id);
      if (product) {
        document.getElementById("product-id").value = product.id;
        document.getElementById("product-name").value = product.name;
        document.getElementById("product-unit").value = product.unit;
        document.getElementById("product-name").focus();
      }
    },
    
// 10.4 Delete Product
    deleteProduct(id) {
      if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบสินค้านี้? การกระทำนี้จะลบสินค้าออกจากระบบ แต่จะไม่ลบประวัติการขายหรือการนำเข้าที่เกี่ยวข้อง")) {
        this._markAsDeleted(id);
        this.data.products = this.data.products.filter((p) => p.id != id);
        this.saveData();
        this.renderProductTable();
      }
    },

    // =================================================================
    // 11. STORE MANAGEMENT
    // =================================================================
    
    // 11.1 Render Store Table
    renderStoreTable() {
      const tbody = document.querySelector("#store-table tbody");
      tbody.innerHTML = "";
      this.data.stores.forEach((s) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td data-label="ชื่อร้านค้า">${s.name}</td><td data-label="จัดการ"><div class="action-buttons"><button class="edit-store-btn" data-id="${s.id}" style="background-color: var(--warning-color);">แก้ไข</button><button class="danger delete-store-btn" data-id="${s.id}">ลบ</button></div></td>`;
        tbody.appendChild(tr);
      });
    },
    
    // 11.2 Save Store
    saveStore(e) {
      e.preventDefault();
      const id = document.getElementById("store-id").value;
      const name = document.getElementById("store-name").value.trim();
      if (!name) {
        this.showToast("กรุณากรอกชื่อร้าน", "error");
        return;
      }
      if (id) {
        const storeId = parseInt(id, 10);
        const storeIndex = this.data.stores.findIndex((s) => s.id === storeId);
        if (storeIndex > -1) {
          const oldStore = this.data.stores[storeIndex];
          if (oldStore.name !== name) {
            this.data.sales.forEach((sale) => { if (sale.storeId === storeId) sale.storeName = name; });
            this.showToast("อัปเดตชื่อร้านในประวัติการขายเรียบร้อย");
          }
          this.data.stores[storeIndex].name = name;
          this.showToast("แก้ไขชื่อร้านสำเร็จ", "success");
        }
      } else {
        this.data.stores.push({ id: Date.now(), name });
        this.showToast("เพิ่มร้านใหม่สำเร็จ");
      }
      this.saveData();
      this.renderStoreTable();
      document.getElementById("store-form").reset();
      document.getElementById("store-id").value = "";
    },
    
    // 11.3 Edit Store
    editStore(id) {
      const store = this.data.stores.find((s) => s.id == id);
      if (store) {
        document.getElementById("store-id").value = store.id;
        document.getElementById("store-name").value = store.name;
        document.getElementById("store-name").focus();
      }
    },
    
// 11.4 Delete Store
    deleteStore(id) {
      const isStoreInUse = this.data.users.some((u) => u.storeId == id);
      if (isStoreInUse) {
        this.showToast("ไม่สามารถลบร้านค้านี้ได้ เนื่องจากมีผู้ใช้สังกัดอยู่", "error");
        return;
      }
      if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบร้านค้านี้?")) {
        this._markAsDeleted(id);
        this.data.stores = this.data.stores.filter((s) => s.id != id);
        this.saveData();
        this.renderStoreTable();
        this.showToast("ลบร้านค้าเรียบร้อย");
      }
    },

    // =================================================================
    // 12. USER MANAGEMENT
    // =================================================================
    
    // 12.1 Render User Table
    renderUserTable() {
      const tbody = document.querySelector("#user-table tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      this.data.users.forEach((u) => {
        let assignedText = "N/A";
        if (u.role === "seller") {
          const assignedIds = u.assignedProductIds || [];
          if (this.data.products.length > 0 && assignedIds.length === this.data.products.length) assignedText = "ทั้งหมด";
          else if (assignedIds.length > 0) assignedText = `${assignedIds.length} รายการ`;
          else assignedText = "ยังไม่กำหนด";
        }
        let salesPeriodText = "N/A";
        if (u.role === "seller") {
          const formatDate = (dateStr) => this.formatThaiDateShortYear(dateStr);
          const start = formatDate(u.salesStartDate);
          const end = formatDate(u.salesEndDate);
          if (start !== "-" || end !== "-") salesPeriodText = `${start !== "-" ? start : "ไม่กำหนด"} - ${end !== "-" ? end : "ไม่กำหนด"}`;
          else salesPeriodText = "ไม่กำหนด";
        }
        const store = this.data.stores.find((s) => s.id === u.storeId);
        const storeName = store ? store.name : "ยังไม่กำหนด";
        const tr = document.createElement("tr");
        tr.innerHTML = `<td data-label="ชื่อผู้ใช้">${u.username}</td><td data-label="ประเภท">${u.role}</td><td data-label="ร้านค้า">${storeName}</td><td data-label="สินค้าที่ขายได้">${assignedText}</td><td data-label="ระยะเวลาที่ขายได้">${salesPeriodText}</td><td data-label="จัดการ"><div class="action-buttons"><button class="edit-user-btn" data-id="${u.id}" style="background-color: var(--warning-color);">แก้ไข</button>${u.username !== "admin" ? `<button class="danger delete-user-btn" data-id="${u.id}">ลบ</button>` : ""}</div></td>`;
        tbody.appendChild(tr);
      });
      this.setupUserForm();
    },
    
    // 12.2 Save User
    saveUser(e) {
      e.preventDefault();
      const id = document.getElementById("user-id").value;
      const username = document.getElementById("user-username").value;
      const password = document.getElementById("user-password").value;
      const confirmPassword = document.getElementById("user-password-confirm").value;
      const role = document.getElementById("user-role").value;
      const startDate = document.getElementById("user-sales-start-date").value;
      const endDate = document.getElementById("user-sales-end-date").value;
      if (!username.trim()) {
        this.showToast("กรุณากรอกชื่อผู้ใช้", "error");
        return;
      }
      if (password !== confirmPassword) {
        this.showToast("รหัสผ่านไม่ตรงกัน", "error");
        return;
      }
      let assignedProductIds = [];
      let storeId = null;
      let commissionRate = 0, commissionOnCash = false, commissionOnTransfer = false, commissionOnCredit = false;
      let visibleSalesDays = null;
      if (role === "seller") {
        const storeSelect = document.getElementById("user-store-select");
        storeId = storeSelect ? storeSelect.value : null;
        if (!storeId) {
          this.showToast("กรุณาระบุร้านค้าสำหรับผู้ขาย", "error");
          return;
        }
        storeId = parseInt(storeId, 10);
        if (!startDate || !endDate) {
          this.showToast("กรุณากำหนดระยะเวลาการขายให้ครบถ้วน", "error");
          return;
        }
        if (new Date(startDate) > new Date(endDate)) {
          this.showToast("วันที่เริ่มขายต้องมาก่อนหรือวันเดียวกับวันที่สิ้นสุด", "error");
          return;
        }
        const checkboxes = document.querySelectorAll("#user-product-assignment input:checked");
        assignedProductIds = Array.from(checkboxes).map((cb) => parseInt(cb.value, 10));
        commissionRate = parseFloat(document.getElementById("user-commission-rate").value) || 0;
        commissionOnCash = document.getElementById("user-commission-cash").checked;
        commissionOnTransfer = document.getElementById("user-commission-transfer").checked;
        commissionOnCredit = document.getElementById("user-commission-credit").checked;
        const visibleDaysInput = document.getElementById("user-visible-days").value;
        if (visibleDaysInput) {
          const parsedDays = parseInt(visibleDaysInput, 10);
          if (!isNaN(parsedDays) && parsedDays >= 0) visibleSalesDays = parsedDays;
        }
      }
      if (id) {
        const user = this.data.users.find((u) => u.id == id);
        if (user.username !== username) {
          this.data.sales.forEach((sale) => { if (sale.sellerId == id) sale.sellerName = username; });
        }
        user.username = username;
        if (password) user.password = password;
        user.role = role;
        if (role === "seller") {
          user.assignedProductIds = assignedProductIds;
          user.salesStartDate = startDate;
          user.salesEndDate = endDate;
          user.storeId = storeId;
          user.commissionRate = commissionRate;
          user.commissionOnCash = commissionOnCash;
          user.commissionOnTransfer = commissionOnTransfer;
          user.commissionOnCredit = commissionOnCredit;
          user.visibleSalesDays = visibleSalesDays;
        } else {
          delete user.assignedProductIds;
          delete user.salesStartDate;
          delete user.salesEndDate;
          delete user.storeId;
          delete user.commissionRate;
          delete user.commissionOnCash;
          delete user.commissionOnTransfer;
          delete user.commissionOnCredit;
          delete user.visibleSalesDays;
        }
        user.updatedAt = Date.now();
        this.showToast("แก้ไขข้อมูลผู้ใช้สำเร็จ");
      } else {
        if (this.data.users.some((u) => u.username === username)) {
          this.showToast("ชื่อผู้ใช้นี้มีอยู่แล้ว", "error");
          return;
        }
        if (!password) {
          this.showToast("กรุณากำหนดรหัสผ่านสำหรับผู้ใช้ใหม่", "error");
          return;
        }
        const newUser = { id: Date.now(), username, password, role, updatedAt: Date.now() };
        if (role === "seller") {
          newUser.assignedProductIds = assignedProductIds;
          newUser.salesStartDate = startDate;
          newUser.salesEndDate = endDate;
          newUser.storeId = storeId;
          newUser.commissionRate = commissionRate;
          newUser.commissionOnCash = commissionOnCash;
          newUser.commissionOnTransfer = commissionOnTransfer;
          newUser.commissionOnCredit = commissionOnCredit;
          newUser.visibleSalesDays = visibleSalesDays;
        }
        this.data.users.push(newUser);
        this.showToast("เพิ่มผู้ใช้ใหม่สำเร็จ");
      }
      this.saveData();
      this.renderUserTable();
    },
    
    // 12.3 Edit User
    editUser(id) {
      const user = this.data.users.find((p) => p.id == id);
      if (user) this.setupUserForm(user);
    },
    
// 12.4 Delete User
    deleteUser(id) {
      const user = this.data.users.find((u) => u.id == id);
      if (user && user.username === "admin") {
        this.showToast("ไม่สามารถลบผู้ใช้ admin ได้", "error");
        return;
      }
      if (confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้ ${user.username}?`)) {
        this._markAsDeleted(id);
        this.data.users = this.data.users.filter((u) => u.id != id);
        this.saveData();
        this.renderUserTable();
      }
    },
    
    // 12.5 Setup User Form
    setupUserForm(user = null) {
      const form = document.getElementById("user-form");
      form.reset();
      document.getElementById("user-password-confirm").value = "";
      const productContainer = document.getElementById("user-product-assignment-container");
      const salesContainer = document.getElementById("user-sales-period-container");
      const storeContainer = document.getElementById("user-store-assignment-container");
      const commissionContainer = document.getElementById("user-commission-settings-container");
      const historyContainer = document.getElementById("user-history-view-container");
      const sellerFields = [productContainer, salesContainer, storeContainer, commissionContainer, historyContainer];
      if (user) {
        document.getElementById("user-id").value = user.id;
        document.getElementById("user-username").value = user.username;
        document.getElementById("user-role").value = user.role;
        document.getElementById("user-password").value = "";
        document.getElementById("user-password").placeholder = "เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน";
        document.getElementById("user-password-confirm").placeholder = "เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน";
        if (user.role === "seller") {
          sellerFields.forEach((c) => (c.style.display = "grid"));
          document.getElementById("user-commission-rate").value = user.commissionRate || 0;
          document.getElementById("user-commission-cash").checked = user.commissionOnCash || false;
          document.getElementById("user-commission-transfer").checked = user.commissionOnTransfer || false;
          document.getElementById("user-commission-credit").checked = user.commissionOnCredit || false;
          document.getElementById("user-visible-days").value = user.visibleSalesDays ?? "";
          this.renderUserStoreAssignment(user.storeId);
          this.renderUserProductAssignment(user.assignedProductIds || []);
          document.getElementById("user-sales-start-date").value = user.salesStartDate || "";
          document.getElementById("user-sales-end-date").value = user.salesEndDate || "";
        } else {
          sellerFields.forEach((c) => (c.style.display = "none"));
        }
      } else {
        document.getElementById("user-id").value = "";
        document.getElementById("user-password").placeholder = "กำหนดรหัสผ่านสำหรับผู้ใช้ใหม่";
        document.getElementById("user-password-confirm").placeholder = "ยืนยันรหัสผ่าน";
        sellerFields.forEach((c) => (c.style.display = "grid"));
        document.getElementById("user-role").value = "seller";
        document.getElementById("user-commission-rate").value = "";
        document.getElementById("user-commission-cash").checked = false;
        document.getElementById("user-commission-transfer").checked = false;
        document.getElementById("user-commission-credit").checked = false;
        document.getElementById("user-visible-days").value = "";
        this.renderUserStoreAssignment();
        this.renderUserProductAssignment();
      }
      document.getElementById("user-username").focus();
    },
    
    // 12.6 Render User Product Assignment
    renderUserProductAssignment(selectedIds = []) {
      const container = document.getElementById("user-product-assignment");
      if (!container) return;
      container.innerHTML = "";
      if (this.data.products.length === 0) {
        container.innerHTML = "<p>ยังไม่มีสินค้าในระบบ โปรดเพิ่มสินค้าก่อน</p>";
        return;
      }
      this.data.products.forEach((p) => {
        const isChecked = selectedIds.includes(p.id);
        container.innerHTML += `<label class="product-item" style="display: block; margin-bottom: 5px;"><input type="checkbox" value="${p.id}" ${isChecked ? "checked" : ""}> ${p.name}</label>`;
      });
    },
    
    // 12.7 Render User Store Assignment
    renderUserStoreAssignment(selectedStoreId = null) {
      const container = document.getElementById("user-store-assignment-container");
      if (!container) return;
      container.innerHTML = "";
      if (this.data.stores.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: red;">ยังไม่มีร้านค้าในระบบ! กรุณาไปที่หน้า "จัดการร้านค้า" เพื่อเพิ่มร้านค้าก่อน</p>';
        return;
      }
      let selectHTML = '<label for="user-store-select">เลือกร้านค้า:</label><select id="user-store-select"><option value="">-- กรุณาเลือกร้านค้า --</option>';
      this.data.stores.forEach((s) => {
        const isSelected = s.id == selectedStoreId;
        selectHTML += `<option value="${s.id}" ${isSelected ? "selected" : ""}>${s.name}</option>`;
      });
      selectHTML += "</select>";
      container.innerHTML = selectHTML;
    },

    // =================================================================
    // 13. POS (POINT OF SALE)
    // =================================================================
    
// 13.1 Render POS
    renderPos(payload = null) {
      this.editingSaleContext = null;
      const productSelect = document.getElementById("pos-product");
      if (!productSelect) return;
      let availableProducts = this.data.products;
      
      if (this.currentUser.role === "seller") {
        const assignedIds = this.currentUser.assignedProductIds || [];
        // แปลง ID เป็น String ก่อนตรวจสอบ
        availableProducts = availableProducts.filter((p) => assignedIds.map(String).includes(String(p.id)));
      }
      
      const productsInStock = availableProducts.filter((p) => p.stock > 0);
      if (this.currentUser.role === "seller" && productsInStock.length === 1) {
        const singleProduct = productsInStock[0];
        productSelect.innerHTML = `<option value="${singleProduct.id}">${singleProduct.name} (คงเหลือ: ${this.formatNumberSmart(singleProduct.stock)})</option>`;
        productSelect.disabled = true;
        productSelect.classList.add("single-product-seller");
        productSelect.value = singleProduct.id;
      } else {
        productSelect.innerHTML = '<option value="">--- เลือกสินค้า ---</option>';
        productsInStock.forEach((p) => {
          productSelect.innerHTML += `<option value="${p.id}">${p.name} (คงเหลือ: ${this.formatNumberSmart(p.stock)})</option>`;
        });
        productSelect.disabled = false;
        productSelect.classList.remove("single-product-seller");
      }
      if (this.posTimeInterval) {
        clearInterval(this.posTimeInterval);
        this.posTimeInterval = null;
      }
      if (payload) {
        this.posTimeManuallyChanged = true;
        this.editingSaleContext = { sellerId: payload.sellerId, sellerName: payload.sellerName, storeId: payload.storeId, storeName: payload.storeName };
        this.cart = [];
        payload.items.forEach((item) => {
          const product = this.data.products.find((p) => p.id === item.productId);
          if (product) {
            const costAtTimeOfSale = typeof item.cost === "number" && !isNaN(item.cost) ? item.cost : product.costPrice;
            this.cart.push({ id: product.id, name: product.name, quantity: item.quantity, sellingPrice: item.price, costPrice: costAtTimeOfSale, isSpecialPrice: item.isSpecialPrice, originalPrice: item.originalPrice });
          }
        });
        if (payload.paymentMethod === "เครดิต") {
          document.querySelector('input[name="payment-method"][value="เครดิต"]').checked = true;
          document.getElementById("credit-buyer-name").value = payload.buyerName || "";
          if (payload.creditDueDate && payload.date) {
            const saleD = new Date(payload.date);
            const dueD = new Date(payload.creditDueDate);
            const timeDiff = dueD.getTime() - saleD.getTime();
            const dayDiff = Math.round(timeDiff / (1000 * 3600 * 24));
            document.getElementById("credit-due-days").value = dayDiff >= 0 ? dayDiff : "";
          } else {
            document.getElementById("credit-due-days").value = "";
          }
        } else if (payload.paymentMethod === "เงินโอน") {
          document.querySelector('input[name="payment-method"][value="เงินโอน"]').checked = true;
          document.getElementById("transfer-name").value = payload.transferorName || "";
        } else {
          document.querySelector('input[name="payment-method"][value="เงินสด"]').checked = true;
        }
        const d = new Date(payload.date);
        document.getElementById("pos-date").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        document.getElementById("pos-time").value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      } else {
        this.posTimeManuallyChanged = false;
        const dateInput = document.getElementById("pos-date");
        const timeInput = document.getElementById("pos-time");
        const updateClock = () => {
          if (this.posTimeManuallyChanged) return;
          const now = new Date();
          dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          timeInput.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        };
        updateClock();
        this.posTimeInterval = setInterval(updateClock, 1000);
        if (this.cart.length === 0) {
          document.querySelector('input[name="payment-method"][value="เงินสด"]').checked = true;
          document.getElementById("pos-date").classList.remove("backdating-active");
          document.getElementById("pos-time").classList.remove("backdating-active");
        }
      }
      this.renderCart();
      this.togglePaymentDetailFields();
      this.updateSpecialPriceInfo();
    },
    
    // 13.2 Render Cart
    renderCart() {
      const tbody = document.querySelector("#cart-table tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      let total = 0;
      this.cart.forEach((item, index) => {
        const tr = document.createElement("tr");
        const itemTotal = item.sellingPrice * item.quantity;
        total += itemTotal;
        let itemName = item.name;
        if (item.isSpecialPrice) itemName += ` <span style="font-weight:bold;">(พิเศษ)</span>`;
        tr.innerHTML = `<td data-label="สินค้า">${itemName}</td><td data-label="ราคาฯ">${this.formatNumberSmart(item.sellingPrice)}</td><td data-label="จำนวน">${this.formatNumberSmart(item.quantity)}</td><td data-label="รวม">${this.formatNumberSmart(itemTotal)}</td><td data-label="ลบ"><div class="action-buttons"><button class="danger remove-from-cart-btn" data-index="${index}">ลบ</button></div></td>`;
        tbody.appendChild(tr);
      });
      document.getElementById("cart-total").textContent = `฿${this.formatNumberSmart(total)}`;
    },
    
    // 13.3 Add To Cart
    addToCart(e) {
      e.preventDefault();
      const productId = document.getElementById("pos-product").value;
      if (!productId) {
        this.showToast("กรุณาเลือกสินค้า");
        return;
      }
      const quantity = parseInt(document.getElementById("pos-quantity").value);
      const product = this.data.products.find((p) => p.id == productId);
      if (quantity > product.stock) {
        this.showToast("สินค้าในสต็อกไม่เพียงพอ");
        return;
      }
      const specialPriceInput = document.getElementById("special-price");
      let sellingPrice = product.sellingPrice;
      let isSpecialPrice = false;
      if (specialPriceInput.parentElement.parentElement.style.display !== "none" && specialPriceInput.value.trim() !== "") {
        const newPrice = parseFloat(specialPriceInput.value);
        if (!isNaN(newPrice) && newPrice >= 0) {
          sellingPrice = newPrice;
          isSpecialPrice = true;
        }
      }
      const existingCartItem = this.cart.find((item) => item.id === product.id && item.sellingPrice === sellingPrice);
      if (existingCartItem) {
        existingCartItem.quantity += quantity;
      } else {
        this.cart.push({ id: product.id, name: product.name, quantity: quantity, sellingPrice: sellingPrice, costPrice: product.costPrice, isSpecialPrice: isSpecialPrice, originalPrice: product.sellingPrice });
      }
      this.renderCart();
      const productSelect = document.getElementById("pos-product");
      if (!productSelect.disabled) productSelect.value = "";
      document.getElementById("pos-quantity").value = 1;
      document.getElementById("special-price").value = "";
      this.updateSpecialPriceInfo();
    },
    
    // 13.4 Remove From Cart
    removeFromCart(index) {
      this.cart.splice(index, 1);
      this.renderCart();
    },
    
    // 13.5 Process Sale
    processSale() {
      if (this.cart.length === 0) {
        this.showToast("ตะกร้าว่างเปล่า");
        return;
      }
      try {
        const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
        let buyerName = null, creditDueDateValue = null, transferorName = null;
        if (paymentMethod === "เครดิต") {
          const buyerNameInput = document.getElementById("credit-buyer-name");
          buyerName = buyerNameInput.value.trim();
          if (!buyerName) {
            this.showToast("สำหรับรายการเครดิต กรุณาระบุชื่อผู้ซื้อ");
            buyerNameInput.focus();
            return;
          }
          const creditDaysInput = document.getElementById("credit-due-days").value;
          const creditDays = parseInt(creditDaysInput);
          if (!isNaN(creditDays) && creditDays >= 0) {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + creditDays);
            creditDueDateValue = dueDate.toISOString();
          }
        } else if (paymentMethod === "เงินโอน") {
          const transferorNameInput = document.getElementById("transfer-name");
          transferorName = transferorNameInput.value.trim();
          if (!transferorName) {
            this.showToast("สำหรับรายการเงินโอน กรุณาระบุชื่อผู้โอน");
            transferorNameInput.focus();
            return;
          }
        }
        let saleDate = new Date();
        const dateInput = document.getElementById("pos-date").value;
        const timeInput = document.getElementById("pos-time").value;
        if (dateInput) {
          const [year, month, day] = dateInput.split("-");
          saleDate.setFullYear(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
        if (timeInput) {
          const [hours, minutes] = timeInput.split(":");
          saleDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        }
        if (paymentMethod === "เครดิต" && creditDueDateValue) {
          const creditDays = parseInt(document.getElementById("credit-due-days").value);
          if (!isNaN(creditDays) && creditDays >= 0) {
            const dueDate = new Date(saleDate);
            dueDate.setDate(dueDate.getDate() + creditDays);
            creditDueDateValue = dueDate.toISOString();
          }
        }
        let totalSale = 0, totalCost = 0;
        const saleItems = this.cart.map((item) => {
          const product = this.data.products.find((p) => p.id === item.id);
          if (product) {
            if (item.quantity > product.stock) throw new Error(`สินค้าไม่พอ: ${product.name}`);
            product.stock -= item.quantity;
          }
          totalSale += item.sellingPrice * item.quantity;
          totalCost += item.costPrice * item.quantity;
          return { productId: item.id, name: item.name, quantity: item.quantity, price: item.sellingPrice, cost: item.costPrice, isSpecialPrice: item.isSpecialPrice, originalPrice: item.originalPrice };
        });
        const sellerAndStoreInfo = {};
        if (this.editingSaleContext) {
          sellerAndStoreInfo.sellerId = this.editingSaleContext.sellerId;
          sellerAndStoreInfo.sellerName = this.editingSaleContext.sellerName;
          sellerAndStoreInfo.storeId = this.editingSaleContext.storeId;
          sellerAndStoreInfo.storeName = this.editingSaleContext.storeName;
        } else {
          sellerAndStoreInfo.sellerId = this.currentUser.id;
          sellerAndStoreInfo.sellerName = this.currentUser.username;
          const store = this.data.stores.find((s) => s.id === this.currentUser.storeId);
          sellerAndStoreInfo.storeId = store ? store.id : null;
          sellerAndStoreInfo.storeName = store ? store.name : null;
        }
        const saleRecord = {
          id: Date.now(), date: saleDate.toISOString(), items: saleItems, total: totalSale, profit: totalSale - totalCost, paymentMethod,
          buyerName: buyerName, creditDueDate: creditDueDateValue, transferorName: transferorName,
          sellerId: sellerAndStoreInfo.sellerId, sellerName: sellerAndStoreInfo.sellerName, storeId: sellerAndStoreInfo.storeId, storeName: sellerAndStoreInfo.storeName
        };
        this.data.sales.push(saleRecord);
        this.saveData();
        this.cart = [];
        this.editingSaleContext = null;
        this.renderPos();
        document.getElementById("pos-quantity").value = 1;
        document.getElementById("special-price").value = "";
        this.updateSpecialPriceInfo();
        this.showToast("✓ บันทึกการขายสำเร็จ!");
      } catch (e) {
        this.showToast(e.message, "error");
        console.error(e.message);
      }
    },
    
    // 13.6 Toggle Payment Detail Fields
    togglePaymentDetailFields() {
      const creditFieldsContainer = document.getElementById("credit-fields-container");
      const transferFieldsContainer = document.getElementById("transfer-fields-container");
      const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
      if (paymentMethod === "เครดิต") {
        creditFieldsContainer.style.display = "block";
        transferFieldsContainer.style.display = "none";
        document.getElementById("transfer-name").value = "";
      } else if (paymentMethod === "เงินโอน") {
        transferFieldsContainer.style.display = "block";
        creditFieldsContainer.style.display = "none";
        document.getElementById("credit-buyer-name").value = "";
        document.getElementById("credit-due-days").value = "";
      } else {
        creditFieldsContainer.style.display = "none";
        transferFieldsContainer.style.display = "none";
        document.getElementById("credit-buyer-name").value = "";
        document.getElementById("credit-due-days").value = "";
        document.getElementById("transfer-name").value = "";
      }
    },
    
    // 13.7 Toggle Special Price
    toggleSpecialPrice() {
      const container = document.getElementById("special-price-container");
      const input = document.getElementById("special-price");
      if (container.style.display === "none") {
        container.style.display = "grid";
        input.focus();
      } else {
        container.style.display = "none";
        input.value = "";
      }
    },
    
    // 13.8 Update Special Price Info
    updateSpecialPriceInfo() {
      const productId = document.getElementById("pos-product").value;
      const infoSpan = document.getElementById("current-price-info");
      if (infoSpan) {
        if (productId) {
          const product = this.data.products.find((p) => p.id == productId);
          infoSpan.textContent = `ราคาปกติ: ${this.formatNumberSmart(product.sellingPrice)} บาท`;
        } else {
          infoSpan.textContent = "";
        }
      }
    },

    // =================================================================
    // 14. SALES HISTORY MANAGEMENT
    // =================================================================
    
    // 14.1 Render Sales History (Admin)
    renderSalesHistory() {
      const tbody = document.querySelector("#sales-history-table tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      [...this.data.sales].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((sale) => {
        const tr = document.createElement("tr");
        const saleDate = new Date(sale.date);
        const dateString = this.formatThaiDateShortYear(sale.date);
        const timeString = `${String(saleDate.getHours()).padStart(2, "0")}.${String(saleDate.getMinutes()).padStart(2, "0")} น.`;
        const itemsList = sale.items.map((item) => {
          let itemText = `${item.name} (x${this.formatNumberSmart(item.quantity)})`;
          if (item.isSpecialPrice) itemText += ` <span style="color:red;">(พิเศษ ฿${this.formatNumberSmart(item.price)})</span>`;
          return itemText;
        }).join("<br>");
        let paymentDisplay = sale.paymentMethod || "-";
        if (sale.paymentMethod === "เครดิต" && sale.buyerName) paymentDisplay = `${sale.paymentMethod} (${sale.buyerName})`;
        else if (sale.paymentMethod === "เงินโอน" && sale.transferorName) paymentDisplay = `${sale.paymentMethod} (${sale.transferorName})`;
        tr.innerHTML = `<td data-label="วันที่">${dateString}</td><td data-label="เวลา">${timeString}</td><td data-label="รายการสินค้า">${itemsList}</td><td data-label="ยอดขายรวม">${this.formatNumberSmart(sale.total)}</td><td data-label="กำไรรวม" style="color:${sale.profit >= 0 ? "green" : "red"};">${this.formatNumberSmart(sale.profit)}</td><td data-label="ประเภทชำระ">${paymentDisplay}</td><td data-label="คนขาย">${sale.sellerName}</td><td data-label="ร้านค้า">${sale.storeName || "-"}</td><td data-label="จัดการ"><div class="action-buttons"><button class="edit-sale-btn" data-id="${sale.id}" style="background-color: var(--warning-color);">แก้ไข</button><button class="danger delete-sale-btn" data-id="${sale.id}">ลบ</button></div></td>`;
        tbody.appendChild(tr);
      });
    },
    
    // 14.2 Render Seller Sales History With Filter
    renderSellerSalesHistoryWithFilter() {
      const tbody = document.querySelector("#seller-sales-history-table tbody");
      if (!tbody || this.currentUser.role !== "seller") return;
      const radioChecked = document.querySelector('input[name="seller-filter-type"]:checked');
      const filterType = radioChecked ? radioChecked.value : "today";
      let filterStartDate = new Date();
      let filterEndDate = new Date();
      if (filterType === "today") {
        filterStartDate.setHours(0, 0, 0, 0);
        filterEndDate.setHours(23, 59, 59, 999);
      } else if (filterType === "by_date") {
        let selectedDateStr = document.getElementById("seller-filter-date").value;
        if (!selectedDateStr) {
          selectedDateStr = new Date().toISOString().split('T')[0];
          document.getElementById("seller-filter-date").value = selectedDateStr;
        }
        filterStartDate = new Date(selectedDateStr);
        filterStartDate.setHours(0, 0, 0, 0);
        filterEndDate = new Date(selectedDateStr);
        filterEndDate.setHours(23, 59, 59, 999);
      } else if (filterType === "by_range") {
        const startDateStr = document.getElementById("seller-filter-start-date").value;
        const endDateStr = document.getElementById("seller-filter-end-date").value;
        if (!startDateStr || !endDateStr) {
          this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "warning");
          return;
        }
        filterStartDate = new Date(startDateStr);
        filterStartDate.setHours(0, 0, 0, 0);
        filterEndDate = new Date(endDateStr);
        filterEndDate.setHours(23, 59, 59, 999);
        if (filterStartDate > filterEndDate) {
          this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error");
          return;
        }
      }
      const visibleDays = this.currentUser.visibleSalesDays;
      if (typeof visibleDays === "number" && visibleDays >= 0) {
        let allowedDate = new Date();
        allowedDate.setDate(allowedDate.getDate() - visibleDays);
        allowedDate.setHours(0, 0, 0, 0);
        if (filterStartDate < allowedDate) {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red; padding: 20px;">คุณได้รับอนุญาตให้ดูประวัติย้อนหลังได้ไม่เกิน ${visibleDays} วัน<br>(ดูได้ตั้งแต่วันที่ ${this.formatThaiDateShortYear(allowedDate)})</td></tr>`;
          return;
        }
      }
      const mySales = this.data.sales.filter((sale) => {
        if (sale.sellerId !== this.currentUser.id) return false;
        const saleDate = new Date(sale.date);
        return saleDate >= filterStartDate && saleDate <= filterEndDate;
      });
      tbody.innerHTML = "";
      if (mySales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #777;">ไม่พบรายการขายในช่วงเวลานี้</td></tr>';
        return;
      }
      mySales.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((sale) => {
        const tr = document.createElement("tr");
        const saleObj = new Date(sale.date);
        const dateString = this.formatThaiDateShortYear(sale.date);
        const timeString = `${String(saleObj.getHours()).padStart(2, "0")}:${String(saleObj.getMinutes()).padStart(2, "0")} น.`;
        const itemsList = sale.items.map(item => `<div>${item.name} <span style="color:#666; font-size:0.9em;">(x${this.formatNumberSmart(item.quantity)})</span></div>`).join("");
        let paymentDisplay = sale.paymentMethod || "-";
        if (sale.paymentMethod === "เครดิต" && sale.buyerName) paymentDisplay += ` <br><span style="font-size:0.85em; color:#d63384;">(${sale.buyerName})</span>`;
        else if (sale.paymentMethod === "เงินโอน" && sale.transferorName) paymentDisplay += ` <br><span style="font-size:0.85em; color:#0d6efd;">(${sale.transferorName})</span>`;
        tr.innerHTML = `<td data-label="วันที่">${dateString}</td><td data-label="เวลา">${timeString}</td><td data-label="รายการสินค้า" style="text-align:left;">${itemsList}</td><td data-label="ยอดขาย" style="font-weight:bold;">${this.formatNumberSmart(sale.total)}</td><td data-label="ประเภทชำระ">${paymentDisplay}</td><td data-label="จัดการ"><button class="danger seller-delete-sale-btn" data-id="${sale.id}" style="padding: 5px 10px; font-size: 0.9em;">ลบ</button></td>`;
        tbody.appendChild(tr);
      });
    },
    
    // 14.3 Edit Sale
    editSale(saleId) {
      const confirmation = confirm("การแก้ไขจะทำการ **ยกเลิก** รายการขายเดิม และนำสินค้าทั้งหมดกลับเข้าตะกร้าเพื่อให้คุณทำรายการใหม่\n\nคุณต้องการดำเนินการต่อหรือไม่?");
      if (!confirmation) return;
      const saleToEdit = this.deleteSale(saleId, true);
      if (!saleToEdit) return;
      this.showToast("รายการถูกนำกลับเข้าตะกร้าแล้ว กรุณาแก้ไขและยืนยันการขายอีกครั้ง");
      this.showPage("page-pos", saleToEdit);
    },
    
// 14.4 Delete Sale
    deleteSale(saleId, isEditing = false) {
      const saleIndex = this.data.sales.findIndex((s) => s.id == saleId);
      if (saleIndex === -1) {
        this.showToast("ไม่พบรายการขาย");
        return null;
      }
      if (!isEditing && !confirm("คุณแน่ใจหรือไม่ว่าต้องการลบรายการขายนี้? สต็อกสินค้าจะถูกคืนเข้าระบบ")) return null;
      
      this._markAsDeleted(saleId);
      const [saleToDelete] = this.data.sales.splice(saleIndex, 1);
      saleToDelete.items.forEach((item) => {
        const product = this.data.products.find((p) => p.id === item.productId);
        if (product) product.stock += item.quantity;
      });
      this.saveData();
      if (!isEditing) this.showToast("ลบรายการขายและคืนสต็อกเรียบร้อย");
      return saleToDelete;
    },

    // =================================================================
    // 15. REPORTING FUNCTIONS
    // =================================================================
    
    // 15.1 Render Report (Profit/Loss)
    renderReport() {
      const sellerSelect = document.getElementById("report-seller");
      const previouslySelectedSeller = sellerSelect.value;
      sellerSelect.innerHTML = '<option value="all">ทั้งหมด</option>';
      this.data.users.forEach((u) => { sellerSelect.innerHTML += `<option value="${u.id}">${u.username}</option>`; });
      sellerSelect.value = previouslySelectedSeller || "all";
      const startDate = document.getElementById("report-start-date").value;
      const endDate = document.getElementById("report-end-date").value;
      const sellerId = document.getElementById("report-seller").value;
      let filteredSales = this.data.sales;
      if (startDate) filteredSales = filteredSales.filter((s) => s.date >= new Date(startDate).toISOString());
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        filteredSales = filteredSales.filter((s) => s.date <= endOfDay.toISOString());
      }
      if (sellerId !== "all") filteredSales = filteredSales.filter((s) => s.sellerId == sellerId);
      const totalSales = filteredSales.reduce((sum, s) => sum + s.total, 0);
      const totalProfit = filteredSales.reduce((sum, s) => sum + s.profit, 0);
      const totalCost = totalSales - totalProfit;
      document.getElementById("report-total-sales").textContent = `฿${this.formatNumberSmart(totalSales)}`;
      document.getElementById("report-total-cost").textContent = `฿${this.formatNumberSmart(totalCost)}`;
      document.getElementById("report-net-profit").textContent = `฿${this.formatNumberSmart(totalProfit)}`;
      document.getElementById("report-net-profit").style.color = totalProfit >= 0 ? "var(--success-color)" : "var(--danger-color)";
    },
    
    // 15.2 Render Summary Page (Admin)
    renderSummaryPage() {
      const sellerSelect = document.getElementById("summary-seller-select");
      if (sellerSelect) {
        const adminUser = this.data.users.find((u) => u.role === "admin");
        sellerSelect.innerHTML = `<option value="all">-- ผู้ขายทั้งหมด --</option>`;
        if (adminUser) sellerSelect.innerHTML += `<option value="${adminUser.id}">แอดมิน (${adminUser.username})</option>`;
        this.data.users.filter((u) => u.role === "seller").forEach((user) => {
          sellerSelect.innerHTML += `<option value="${user.id}">${user.username}</option>`;
        });
      }
    },
    
    // 15.3 Generate POS Summary Data
    generatePosSummaryData(startDate, endDate, sellerIdFilter = null, paymentTypesFilter = ["เงินสด", "เงินโอน", "เครดิต"]) {
      const summary = { grandTotalSales: 0, grandTotalProfit: 0, grandTotalCash: 0, grandTotalCredit: 0, grandTotalTransfer: 0, salesCount: 0, sellerSummary: {}, totalSellingDays: 0 };
      let salesToProcess = this.data.sales;
      if (sellerIdFilter && sellerIdFilter !== "all") salesToProcess = salesToProcess.filter((s) => s.sellerId == sellerIdFilter);
      const filteredSales = salesToProcess.filter((sale) => {
        const saleDate = new Date(sale.date);
        if (saleDate < startDate || saleDate > endDate) return false;
        const paymentMethod = sale.paymentMethod || "เงินสด";
        if (!paymentTypesFilter.includes(paymentMethod)) return false;
        const seller = this.data.users.find((u) => u.id === sale.sellerId);
        if (seller && seller.role === "seller") {
          if (seller.salesStartDate) {
            const sellerStartDate = new Date(seller.salesStartDate);
            sellerStartDate.setHours(0, 0, 0, 0);
            if (saleDate < sellerStartDate) return false;
          }
          if (seller.salesEndDate) {
            const sellerEndDate = new Date(seller.salesEndDate);
            sellerEndDate.setHours(23, 59, 59, 999);
            if (saleDate > sellerEndDate) return false;
          }
        }
        return true;
      });
      summary.salesCount = filteredSales.length;
      filteredSales.forEach((sale) => {
        const sellerId = sale.sellerId || "unknown";
        if (!summary.sellerSummary[sellerId]) summary.sellerSummary[sellerId] = { sellerName: sale.sellerName || "ไม่ระบุ", totalSales: 0, totalProfit: 0, totalCash: 0, totalCredit: 0, totalTransfer: 0, productSummary: {} };
        const sellerData = summary.sellerSummary[sellerId];
        sellerData.totalSales += sale.total;
        sellerData.totalProfit += sale.profit;
        summary.grandTotalSales += sale.total;
        summary.grandTotalProfit += sale.profit;
        const paymentType = sale.paymentMethod || "เงินสด";
        if (paymentType === "เครดิต") { summary.grandTotalCredit += sale.total; sellerData.totalCredit += sale.total; }
        else if (paymentType === "เงินโอน") { summary.grandTotalTransfer += sale.total; sellerData.totalTransfer += sale.total; }
        else { summary.grandTotalCash += sale.total; sellerData.totalCash += sale.total; }
        sale.items.forEach((item) => {
          const productId = item.productId;
          if (!sellerData.productSummary[productId]) {
            const productInfo = this.data.products.find((p) => p.id === productId);
            sellerData.productSummary[productId] = { name: item.name, stock: productInfo ? productInfo.stock : "N/A", unit: productInfo ? productInfo.unit : "หน่วย", cashQty: 0, creditQty: 0, transferQty: 0, totalQty: 0, totalValue: 0 };
          }
          const productSum = sellerData.productSummary[productId];
          productSum.totalQty += item.quantity;
          productSum.totalValue += item.price * item.quantity;
          if (paymentType === "เครดิต") productSum.creditQty += item.quantity;
          else if (paymentType === "เงินโอน") productSum.transferQty += item.quantity;
          else productSum.cashQty += item.quantity;
        });
      });
      const uniqueSaleDays = new Set();
      filteredSales.forEach((sale) => { const datePart = sale.date.split("T")[0]; uniqueSaleDays.add(datePart); });
      summary.totalSellingDays = uniqueSaleDays.size;
      return summary;
    },
    
    // 15.4 Build POS Summary HTML
    buildPosSummaryHtml(context) {
      const { summaryResult, title, thaiDateString, sellerIdFilter, startDate, endDate, dayCount, stockAsOfDate } = context;
      const isSingleDayReport = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth() && startDate.getDate() === endDate.getDate();
      const formatCurrency = (num) => this.formatNumberSmart(num);
      let dateDisplayString = thaiDateString;
      if (isSingleDayReport) dateDisplayString = ` ${this.formatThaiDateFullYear(startDate)}`;
      else if (dayCount) dateDisplayString = `${thaiDateString} (รวม ${dayCount} วัน)`;
      const summaryTimestamp = this.formatThaiTimestamp(new Date());
      const isSingleSellerReport = !!(sellerIdFilter && sellerIdFilter !== "all");
      let allSellersHtml = "";
      let overallSummaryHtml = "";
      if (this.currentUser.role === "admin" && !isSingleSellerReport) {
        overallSummaryHtml = `<div style="text-align:center;"><div><h2>${title}</h2><p style="font-size:0.8em; color: #0088ff; margin-bottom: 0;">สรุปโดย : ${this.currentUser.username} | สรุปเมื่อ : ${summaryTimestamp}</p><p style="font-size:0.9em; color: #0088ff; font-weight:bold; margin-bottom: 8px;">วันที่ขายสินค้า : ${dateDisplayString}</p></div><hr><h2>ภาพรวมทั้งหมด</h2><p><strong>ยอดเงินสด :</strong> ${formatCurrency(summaryResult.grandTotalCash)} บาท</p><p><strong>ยอดเงินโอน :</strong> ${formatCurrency(summaryResult.grandTotalTransfer)} บาท</p><p><strong>ยอดเครดิต :</strong> ${formatCurrency(summaryResult.grandTotalCredit)} บาท</p><p><strong>ยอดขายรวมทั้งหมด: ${formatCurrency(summaryResult.grandTotalSales)} บาท</strong></p>${!isSingleDayReport ? `<p><strong>จำนวนวันขายทั้งหมด : ${summaryResult.totalSellingDays} วัน</strong></p>` : ""}<p style="font-weight: bold; font-size: 1.2em; color: ${summaryResult.grandTotalProfit >= 0 ? "green" : "red"};"><strong>กำไรสุทธิรวม: ${formatCurrency(summaryResult.grandTotalProfit)} บาท</strong></p></div>`;
      }
      const sellerKeys = Object.keys(summaryResult.sellerSummary);
      if (this.currentUser.role === "admin" && !isSingleSellerReport && sellerKeys.length > 0) allSellersHtml += `<hr style="border-top: 2px solid #333;"><h2 style="border-bottom-color: #607d8b;">รายละเอียดแยกตามผู้ขาย</h2>`;
      sellerKeys.forEach((sellerId) => {
        const sellerData = summaryResult.sellerSummary[sellerId];
        const sectionTitle = isSingleSellerReport ? title : `สรุปยอดขาย: ${sellerData.sellerName}`;
        let productTableRows = "";
        Object.values(sellerData.productSummary).forEach((p) => {
          const stockAtEndOfDay = stockAsOfDate ? stockAsOfDate.get(p.name) : "N/A";
          const formattedStock = typeof stockAtEndOfDay === "number" ? this.formatNumberSmart(stockAtEndOfDay) : "N/A";
          productTableRows += `<tr><td data-label="สินค้า">${p.name}</td><td data-label="เงินสด">${this.formatNumberSmart(p.cashQty)} ${p.unit}</td><td data-label="เงินโอน">${this.formatNumberSmart(p.transferQty)} ${p.unit}</td><td data-label="เครดิต">${this.formatNumberSmart(p.creditQty)} ${p.unit}</td><td data-label="รวม">${this.formatNumberSmart(p.totalQty)} ${p.unit}</td><td data-label="ยอดขาย (บาท)">${formatCurrency(p.totalValue)}</td><td data-label="คงเหลือ">${formattedStock} ${p.unit}</td></tr>`;
        });
        let profitOrCommissionHtml;
        const user = this.data.users.find((u) => u.id == sellerId);
        if (user && user.role === "seller") {
          let commission = 0;
          let commissionText = "ไม่มีคอมมิชชั่น";
          if (user.commissionRate > 0) {
            let commissionBase = 0;
            let sources = [];
            if (user.commissionOnCash) { commissionBase += sellerData.totalCash; sources.push("เงินสด"); }
            if (user.commissionOnTransfer) { commissionBase += sellerData.totalTransfer; sources.push("เงินโอน"); }
            if (user.commissionOnCredit) { commissionBase += sellerData.totalCredit; sources.push("เครดิต"); }
            commission = commissionBase * (user.commissionRate / 100);
            if (sources.length > 0) commissionText = `คอมมิชชั่น (${user.commissionRate}% จากขาย${sources.join("+")}) = ${formatCurrency(commission)} บาท`;
            else commissionText = `ตั้งค่าคอมมิชชั่น ${user.commissionRate}% แต่ไม่ได้เลือกประเภทการขาย`;
          }
          profitOrCommissionHtml = `<p style="font-weight: bold; color: #007bff;"><strong>${commissionText}</strong></p>`;
        } else {
          const profitColor = sellerData.totalProfit >= 0 ? "green" : "red";
          profitOrCommissionHtml = `<p style="color: ${profitColor};"><strong>กำไรรวม: ${formatCurrency(sellerData.totalProfit)} บาท</strong></p>`;
        }
        let creditDetailsHtml = "";
        const creditSalesDetails = this.data.sales.filter(s => s.sellerId == sellerId && s.paymentMethod === "เครดิต" && new Date(s.date) >= startDate && new Date(s.date) <= endDate);
        if (creditSalesDetails.length > 0) {
          let creditRows = "";
          creditSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((s) => {
            const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}( ${this.formatNumberSmart(item.quantity)} ${unit} )`; }).join(", ");
            creditRows += `<tr><td data-label="วันที่">${this.formatThaiDateShortYear(s.date)}</td><td data-label="ผู้ซื้อ">${s.buyerName || "-"}</td><td data-label="รายการ">${itemsList}</td><td data-label="ยอดเงิน(บาท)">${formatCurrency(s.total)}</td><td data-label="กำหนดชำระ">${this.formatThaiDateShortYear(s.creditDueDate)}</td></tr>`;
          });
          creditDetailsHtml = `<div style="margin-top: 15px; text-align:center;"><h2>รายละเอียดลูกหนี้ (เครดิต)</h2><table class="credit-details-table credit-details-sub-table"><thead><tr><th>วันที่</th><th>ผู้ซื้อ</th><th>รายการ</th><th>ยอดเงิน(บาท)</th><th>กำหนดชำระ</th></tr></thead><tbody>${creditRows}</tbody></table></div>`;
        }
        let transferDetailsHtml = "";
        const transferSalesDetails = this.data.sales.filter(s => s.sellerId == sellerId && s.paymentMethod === "เงินโอน" && new Date(s.date) >= startDate && new Date(s.date) <= endDate);
        if (transferSalesDetails.length > 0) {
          let transferRows = "";
          transferSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((s) => {
            const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}( ${this.formatNumberSmart(item.quantity)} ${unit} )`; }).join(", ");
            transferRows += `<tr><td data-label="วันที่">${this.formatThaiDateShortYear(s.date)}</td><td data-label="ผู้โอน">${s.transferorName || "-"}</td><td data-label="รายการ">${itemsList}</td><td data-label="ยอดเงิน(บาท)">${formatCurrency(s.total)}</td></tr>`;
          });
          transferDetailsHtml = `<div style="margin-top: 15px; text-align:center;"><h2>รายละเอียดเงินโอน</h2><table class="transfer-details-table transfer-details-sub-table"><thead><tr><th>วันที่</th><th>ผู้โอน</th><th>รายการ</th><th>ยอดเงิน(บาท)</th></tr></thead><tbody>${transferRows}</tbody></table></div>`;
        }
        allSellersHtml += `<div style="text-align:center; ${!isSingleSellerReport ? "margin-top: 20px;" : ""}"><h2>${sectionTitle}</h2>${isSingleSellerReport ? `<p style="font-size:0.8em; color: #0088ff; margin-bottom: 0;">สรุปโดย : ${this.currentUser.username} | สรุปเมื่อ : ${summaryTimestamp}</p>` : ""}<p style="font-size: 0.9em; color: #0088ff; font-weight: bold; margin-bottom: 8px;">วันที่ขายสินค้า : ${dateDisplayString}</p><p style="margin-bottom: 8px;"><strong>ยอดขายรวม : ${formatCurrency(sellerData.totalSales)} บาท</strong> <br><span style="font-size:0.9em; color: #0088ff;">(เงินสด : ${formatCurrency(sellerData.totalCash)} | เงินโอน : ${formatCurrency(sellerData.totalTransfer)} | เครดิต : ${formatCurrency(sellerData.totalCredit)})</span></p>${!isSingleDayReport ? `<p><strong>จำนวนวันขายทั้งหมด : ${summaryResult.totalSellingDays} วัน</strong></p>` : ""}${profitOrCommissionHtml}<table class="product-summary-table"><thead><tr><th>สินค้า</th><th>เงินสด</th><th>เงินโอน</th><th>เครดิต</th><th>รวม(หน่วย)</th><th>ยอดขาย(บาท)</th><th>คงเหลือ</th></tr></thead><tbody>${productTableRows}</tbody></table>${creditDetailsHtml}${transferDetailsHtml}</div>`;
      });
      return `${overallSummaryHtml}${allSellersHtml || "<p>ไม่พบข้อมูลการขายในช่วงเวลานี้</p>"}`;
    },
    
    // 15.5 Export POS Summary to XLSX
    exportPosSummaryToXlsx(context) {
      const { summaryResult, title, thaiDateString, periodName, sellerIdFilter, startDate, endDate, stockAsOfDate, dayCount } = context;
      const isSingleDayReport = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth() && startDate.getDate() === endDate.getDate();
      let dataRows = [];
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const summaryDateTime = `${day}/${month}/${year + 543} ${hours}:${minutes} น.`;
      const isSingleSellerReport = !!(sellerIdFilter && sellerIdFilter !== "all");
      dataRows.push([title]);
      dataRows.push(["ช่วงวันที่:", thaiDateString]);
      dataRows.push(["สรุปเมื่อ:", summaryDateTime]);
      dataRows.push([]);
      if (this.currentUser.role === "admin" && !isSingleSellerReport) {
        dataRows.push(["--- ภาพรวมทั้งหมด ---"]);
        dataRows.push(["ยอดเงินสด (บาท)", this.formatNumberSmart(summaryResult.grandTotalCash)]);
        dataRows.push(["ยอดเงินโอน (บาท)", this.formatNumberSmart(summaryResult.grandTotalTransfer)]);
        dataRows.push(["ยอดเครดิต (บาท)", this.formatNumberSmart(summaryResult.grandTotalCredit)]);
        dataRows.push(["ยอดขายรวมทั้งหมด (บาท)", this.formatNumberSmart(summaryResult.grandTotalSales)]);
        if (!isSingleDayReport) dataRows.push(["จำนวนวันขายทั้งหมด (วัน)", summaryResult.totalSellingDays]);
        dataRows.push(["กำไรสุทธิรวม (บาท)", this.formatNumberSmart(summaryResult.grandTotalProfit)]);
        dataRows.push([]);
      }
      for (const sellerId in summaryResult.sellerSummary) {
        const sellerData = summaryResult.sellerSummary[sellerId];
        if (dataRows.length > 0) dataRows.push([]);
        dataRows.push([`--- สรุปยอดขาย: ${sellerData.sellerName} ---`]);
        dataRows.push(["ยอดขายรวม (บาท)", this.formatNumberSmart(sellerData.totalSales)]);
        dataRows.push(["ยอดเงินสด (บาท)", this.formatNumberSmart(sellerData.totalCash)]);
        dataRows.push(["ยอดเงินโอน (บาท)", this.formatNumberSmart(sellerData.totalTransfer)]);
        dataRows.push(["ยอดเครดิต (บาท)", this.formatNumberSmart(sellerData.totalCredit)]);
        if (!isSingleDayReport) dataRows.push(["จำนวนวันขายทั้งหมด (วัน)", summaryResult.totalSellingDays]);
        const user = this.data.users.find((u) => u.id == sellerId);
        if (user && user.role === "seller") {
          let commission = 0;
          let commissionLabel = "คอมมิชชั่น (บาท)";
          if (user.commissionRate > 0) {
            let commissionBase = 0;
            let sources = [];
            if (user.commissionOnCash) { commissionBase += sellerData.totalCash; sources.push("เงินสด"); }
            if (user.commissionOnTransfer) { commissionBase += sellerData.totalTransfer; sources.push("เงินโอน"); }
            if (user.commissionOnCredit) { commissionBase += sellerData.totalCredit; sources.push("เครดิต"); }
            commission = commissionBase * (user.commissionRate / 100);
            if (sources.length > 0) commissionLabel = `คอมมิชชั่น (${user.commissionRate}% จาก ${sources.join("+")}) (บาท)`;
          }
          dataRows.push([commissionLabel, this.formatNumberSmart(commission)]);
        } else {
          dataRows.push(["กำไรรวม (บาท)", this.formatNumberSmart(sellerData.totalProfit)]);
        }
        dataRows.push([]);
        dataRows.push(["สินค้า", "ขาย(เงินสด)", "ขาย(เงินโอน)", "ขาย(เครดิต)", "รวม(หน่วย)", "ยอดขาย(บาท)", "คงเหลือ"]);
        Object.values(sellerData.productSummary).forEach((p) => {
          const stockAtEndOfDay = stockAsOfDate ? stockAsOfDate.get(p.name) : "N/A";
          const formattedStock = typeof stockAtEndOfDay === "number" ? this.formatNumberSmart(stockAtEndOfDay) : "N/A";
          dataRows.push([p.name, `${this.formatNumberSmart(p.cashQty)} ${p.unit}`, `${this.formatNumberSmart(p.transferQty)} ${p.unit}`, `${this.formatNumberSmart(p.creditQty)} ${p.unit}`, `${this.formatNumberSmart(p.totalQty)} ${p.unit}`, this.formatNumberSmart(p.totalValue), `${formattedStock} ${p.unit}`]);
        });
        const creditSalesDetails = this.data.sales.filter(s => s.sellerId == sellerId && s.paymentMethod === "เครดิต" && new Date(s.date) >= startDate && new Date(s.date) <= endDate);
        if (creditSalesDetails.length > 0) {
          dataRows.push([]);
          dataRows.push(["--- รายละเอียดลูกหนี้ (เครดิต) ---"]);
          dataRows.push(["วันที่", "ผู้ซื้อ", "รายการ", "ยอดเงิน(บาท)", "กำหนดชำระ"]);
          creditSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((s) => {
            const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`; }).join("; ");
            dataRows.push([this.formatThaiDateFullYear(s.date), s.buyerName || "-", itemsList, this.formatNumberSmart(s.total), this.formatThaiDateFullYear(s.creditDueDate)]);
          });
        }
        const transferSalesDetails = this.data.sales.filter(s => s.sellerId == sellerId && s.paymentMethod === "เงินโอน" && new Date(s.date) >= startDate && new Date(s.date) <= endDate);
        if (transferSalesDetails.length > 0) {
          dataRows.push([]);
          dataRows.push(["--- รายละเอียดเงินโอน ---"]);
          dataRows.push(["วันที่", "ผู้โอน", "รายการ", "ยอดเงิน(บาท)"]);
          transferSalesDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((s) => {
            const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`; }).join("; ");
            dataRows.push([this.formatThaiDateFullYear(s.date), s.transferorName || "-", itemsList, this.formatNumberSmart(s.total)]);
          });
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(dataRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "สรุปภาพรวม");
      const colWidths = [];
      dataRows.forEach((row) => { row.forEach((cell, colIndex) => { const cellLength = cell ? cell.toString().length : 0; if (!colWidths[colIndex] || cellLength > colWidths[colIndex]) colWidths[colIndex] = Math.min(cellLength, 50); }); });
      ws["!cols"] = colWidths.map((width) => ({ width: width + 2 }));
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "binary" });
      function s2ab(s) { const buf = new ArrayBuffer(s.length); const view = new Uint8Array(buf); for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff; return buf; }
      const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
      const fileName = `POS_Summary_${periodName}_${new Date().getTime()}.xlsx`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
    },
    
    // 15.6 Build Detailed List HTML
    buildDetailedListHtml(context) {
      const { filteredSales, title, thaiDateString, sellerId } = context;
      const user = this.data.users.find((u) => u.id == sellerId);
      const isSellerReport = user && user.role === "seller";
      const isAdminReport = this.currentUser.role === "admin";
      let tableRows = "";
      let totalSales = 0;
      let totalProfit = 0;
      filteredSales.forEach((sale) => {
        const saleDate = new Date(sale.date);
        const dateString = this.formatThaiDateShortYear(sale.date);
        const timeString = `${String(saleDate.getHours()).padStart(2, "0")}.${String(saleDate.getMinutes()).padStart(2, "0")} น.`;
        const itemsList = sale.items.map((item) => {
          let itemText = `${item.name} (x${this.formatNumberSmart(item.quantity)})`;
          if (item.isSpecialPrice) itemText += ` <span style="color:red; font-weight:normal;">(พิเศษ ฿${this.formatNumberSmart(item.price)})</span>`;
          return itemText;
        }).join("<br>");
        let paymentDisplay = sale.paymentMethod || "เงินสด";
        if (sale.paymentMethod === "เครดิต" && sale.buyerName) paymentDisplay = `${paymentDisplay} (${sale.buyerName})`;
        else if (sale.paymentMethod === "เงินโอน" && sale.transferorName) paymentDisplay = `${paymentDisplay} (${sale.transferorName})`;
        tableRows += `<tr><td data-label="วันที่">${dateString}</td><td data-label="เวลา">${timeString}</td><td data-label="รายการ">${itemsList}</td><td data-label="ยอดขาย">${this.formatNumberSmart(sale.total)}</td>${isAdminReport ? `<td data-label="กำไร" style="color:${sale.profit >= 0 ? "green" : "red"};">${this.formatNumberSmart(sale.profit)}</td>` : ""}<td data-label="ประเภทชำระ">${paymentDisplay}</td></tr>`;
        totalSales += sale.total;
        if (isAdminReport) totalProfit += sale.profit;
      });
      let footerRows = `<tr style="font-weight: bold; background-color: #f0f0f0; border-top: 2px solid #333;"><td colspan="3" style="text-align: right;">ยอดรวมทั้งหมด:</td><td>${this.formatNumberSmart(totalSales)}</td>${isAdminReport ? `<td style="color:${totalProfit >= 0 ? "green" : "red"};">${this.formatNumberSmart(totalProfit)}</td>` : ""}<td></td></tr>`;
      if (isSellerReport && user.commissionRate > 0) {
        let totalCommission = 0;
        let commissionDetails = [];
        const salesByCash = filteredSales.filter(s => (s.paymentMethod || "เงินสด") === "เงินสด").reduce((sum, s) => sum + s.total, 0);
        const salesByTransfer = filteredSales.filter(s => s.paymentMethod === "เงินโอน").reduce((sum, s) => sum + s.total, 0);
        const salesByCredit = filteredSales.filter(s => s.paymentMethod === "เครดิต").reduce((sum, s) => sum + s.total, 0);
        if (user.commissionOnCash && salesByCash > 0) { const commission = salesByCash * (user.commissionRate / 100); commissionDetails.push({ label: `ยอดขายเงินสด`, amount: salesByCash, commission: commission }); totalCommission += commission; }
        if (user.commissionOnTransfer && salesByTransfer > 0) { const commission = salesByTransfer * (user.commissionRate / 100); commissionDetails.push({ label: `ยอดขายเงินโอน`, amount: salesByTransfer, commission: commission }); totalCommission += commission; }
        if (user.commissionOnCredit && salesByCredit > 0) { const commission = salesByCredit * (user.commissionRate / 100); commissionDetails.push({ label: `ยอดขายเครดิต`, amount: salesByCredit, commission: commission }); totalCommission += commission; }
        if (commissionDetails.length > 0) {
          const colspan = isAdminReport ? 6 : 5;
          footerRows += `<tr style="font-weight: bold; background-color: #e0f7fa;"><td colspan="${colspan}" style="text-align:center;">คำนวณค่าคอมมิชชั่น (${user.commissionRate}%)</td></tr>`;
          commissionDetails.forEach((detail) => { footerRows += `<tr style="background-color: #e0f7fa;"><td colspan="3" style="text-align: right;">${detail.label}: ${this.formatNumberSmart(detail.amount)} บาท</td><td colspan="${colspan - 3}" style="text-align: left; padding-left: 20px; font-weight:bold;">ค่าคอมฯ: ${this.formatNumberSmart(detail.commission)} บาท</td></tr>`; });
          footerRows += `<tr style="font-weight: bold; background-color: #cce7ee;"><td colspan="3" style="text-align: right;">รวมค่าคอมมิชชั่นทั้งหมด:</td><td colspan="${colspan - 3}" style="text-align: left; padding-left: 20px; font-size: 1.1em;">${this.formatNumberSmart(totalCommission)} บาท</td></tr>`;
        }
      }
      const tableClass = isAdminReport ? "detailed-sales-table admin-view" : "detailed-sales-table";
      return `<div style="text-align:center;"><h2>${title}</h2><p style="font-size:0.9em; color:#333; font-weight:bold;">ช่วงวันที่ : ${thaiDateString}</p><div class="table-container"><table class="${tableClass}"><thead><tr><th>วันที่</th><th>เวลา</th><th>รายการสินค้า</th><th>ยอดขาย (บาท)</th>${isAdminReport ? "<th>กำไร (บาท)</th>" : ""}<th>ประเภทชำระ</th></tr></thead><tbody>${tableRows}${footerRows}</tbody></table></div></div>`;
    },
    
    // 15.7 Export Detailed List to XLSX
    exportDetailedListToXlsx(context) {
      const { filteredSales, title, periodName, thaiDateString, sellerId } = context;
      const user = this.data.users.find((u) => u.id == sellerId);
      const isSellerReport = user && user.role === "seller";
      const isAdminReport = this.currentUser.role === "admin";
      let dataRows = [];
      const summaryTimestamp = this.formatThaiTimestamp(new Date());
      dataRows.push([title]);
      dataRows.push(["ช่วงวันที่:", thaiDateString]);
      dataRows.push(["สรุปเมื่อ:", summaryTimestamp]);
      dataRows.push([]);
      let headers = ["วันที่", "เวลา", "รายการสินค้า (ชื่อ)", "ราคาต่อหน่วย", "จำนวน", "ราคารวมต่อรายการ", "ยอดขายรวม (บาท)"];
      if (isAdminReport) headers.push("กำไรรวม (บาท)");
      headers.push("ประเภทชำระ", "รายละเอียดชำระ", "กำหนดชำระ", "ผู้ขาย", "ร้านค้า");
      dataRows.push(headers);
      let grandTotalSales = 0;
      let grandTotalProfit = 0;
      filteredSales.forEach((sale) => {
        const saleDate = new Date(sale.date);
        const dateString = this.formatThaiDateFullYear(sale.date);
        const timeString = `${String(saleDate.getHours()).padStart(2, "0")}:${String(saleDate.getMinutes()).padStart(2, "0")}`;
        let paymentDetail = "-";
        if (sale.paymentMethod === "เครดิต") paymentDetail = sale.buyerName || "-";
        else if (sale.paymentMethod === "เงินโอน") paymentDetail = sale.transferorName || "-";
        const dueDateString = this.formatThaiDateFullYear(sale.creditDueDate);
        grandTotalSales += sale.total;
        if (isAdminReport) grandTotalProfit += sale.profit;
        sale.items.forEach((item, index) => {
          const itemTotal = item.price * item.quantity;
          let row = [index === 0 ? dateString : "", index === 0 ? timeString : "", item.name + (item.isSpecialPrice ? " (พิเศษ)" : ""), this.formatNumberSmart(item.price), this.formatNumberSmart(item.quantity), this.formatNumberSmart(itemTotal), index === 0 ? this.formatNumberSmart(sale.total) : ""];
          if (isAdminReport) row.push(index === 0 ? this.formatNumberSmart(sale.profit) : "");
          row.push(index === 0 ? sale.paymentMethod || "เงินสด" : "", index === 0 ? paymentDetail : "", index === 0 ? dueDateString : "", index === 0 ? sale.sellerName || "-" : "", index === 0 ? sale.storeName || "-" : "");
          dataRows.push(row);
        });
      });
      dataRows.push([]);
      let footerRow = ["", "", "", "", "", "ยอดรวมทั้งหมด", this.formatNumberSmart(grandTotalSales)];
      if (isAdminReport) footerRow.push(this.formatNumberSmart(grandTotalProfit));
      dataRows.push(footerRow);
      if (isSellerReport && user.commissionRate > 0) {
        let totalCommission = 0;
        let commissionDetails = [];
        const salesByCash = filteredSales.filter(s => (s.paymentMethod || "เงินสด") === "เงินสด").reduce((sum, s) => sum + s.total, 0);
        const salesByTransfer = filteredSales.filter(s => s.paymentMethod === "เงินโอน").reduce((sum, s) => sum + s.total, 0);
        const salesByCredit = filteredSales.filter(s => s.paymentMethod === "เครดิต").reduce((sum, s) => sum + s.total, 0);
        if (user.commissionOnCash && salesByCash > 0) { const commission = salesByCash * (user.commissionRate / 100); commissionDetails.push({ label: `ยอดขายเงินสด`, amount: salesByCash, commission: commission }); totalCommission += commission; }
        if (user.commissionOnTransfer && salesByTransfer > 0) { const commission = salesByTransfer * (user.commissionRate / 100); commissionDetails.push({ label: `ยอดขายเงินโอน`, amount: salesByTransfer, commission: commission }); totalCommission += commission; }
        if (user.commissionOnCredit && salesByCredit > 0) { const commission = salesByCredit * (user.commissionRate / 100); commissionDetails.push({ label: `ยอดขายเครดิต`, amount: salesByCredit, commission: commission }); totalCommission += commission; }
        if (commissionDetails.length > 0) {
          dataRows.push([]);
          dataRows.push([`คำนวณค่าคอมมิชชั่น (${user.commissionRate}%)`]);
          commissionDetails.forEach((detail) => { dataRows.push(["", "", "", "", "", `${detail.label}: ${this.formatNumberSmart(detail.amount)} บาท`, `ค่าคอมฯ: ${this.formatNumberSmart(detail.commission)} บาท`]); });
          dataRows.push(["", "", "", "", "", "รวมค่าคอมมิชชั่นทั้งหมด", this.formatNumberSmart(totalCommission)]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(dataRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "รายงานการขาย");
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "binary" });
      function s2ab(s) { const buf = new ArrayBuffer(s.length); const view = new Uint8Array(buf); for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff; return buf; }
      const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
      const fileName = `${periodName}_${new Date().getTime()}.xlsx`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
    },
    
    // 15.8 Build Credit Summary HTML
    buildCreditSummaryHtml(context) {
      const { creditData } = context;
      const { filteredCreditSales, sellerName, startDate, endDate, summaryTimestamp } = creditData;
      const formatCurrency = (num) => this.formatNumberSmart(num);
      const formatDate = (dateStr) => this.formatThaiDateShortYear(dateStr);
      let totalCredit = 0;
      let creditRows = "";
      filteredCreditSales.forEach((s) => {
        totalCredit += s.total;
        const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`; }).join(", ");
        creditRows += `<tr><td data-label="วันที่">${formatDate(s.date)}</td><td data-label="ผู้ซื้อ">${s.buyerName || "-"}</td><td data-label="ผู้ขาย">${s.sellerName || "-"}</td><td data-label="รายการ">${itemsList}</td><td data-label="ยอดเงิน(บาท)">${formatCurrency(s.total)}</td><td data-label="กำหนดชำระ">${formatDate(s.creditDueDate)}</td></tr>`;
      });
      const periodLine = `<p style="font-size:0.9em; color: #333; font-weight: bold; margin-bottom: 8px;">ช่วงเวลา: ${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}</p>`;
      return `<div style="text-align:center;"><h2>สรุปรายการลูกหนี้ของ: ${sellerName}</h2><p style="font-size:0.8em; color:#555; margin-bottom: 0;">สรุปเมื่อ: ${summaryTimestamp}</p>${periodLine}<table class="credit-details-table" style="margin-top: 15px;"><thead><tr><th>วันที่</th><th>ผู้ซื้อ</th><th>ผู้ขาย</th><th>รายการ</th><th>ยอดเงิน (บาท)</th><th>กำหนดชำระ</th></tr></thead><tbody>${creditRows}</tbody></table><p style="text-align:right; font-size:1.2em; font-weight:bold; margin-top:15px;">ยอดรวมลูกหนี้ทั้งหมด: ${formatCurrency(totalCredit)} บาท</p></div>`;
    },
    
    // 15.9 Export Credit Summary to XLSX
    exportCreditSummaryToXlsx(context) {
      const { creditData, periodName } = context;
      const { filteredCreditSales, sellerName, startDate, endDate, summaryTimestamp } = creditData;
      let dataRows = [];
      const formatCurrency = (num) => this.formatNumberSmart(num);
      const formatDate = (dateStr) => this.formatThaiDateFullYear(dateStr);
      const periodString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;
      dataRows.push(["สรุปโดย:", this.currentUser.username]);
      dataRows.push(["สรุปเมื่อ:", summaryTimestamp]);
      dataRows.push([`สรุปรายการลูกหนี้ของ ${sellerName}:`, periodString]);
      dataRows.push([]);
      dataRows.push(["วันที่", "ผู้ซื้อ", "ผู้ขาย", "รายการสินค้า", "ยอดเงิน (บาท)", "กำหนดชำระ"]);
      let totalCredit = 0;
      filteredCreditSales.forEach((s) => {
        totalCredit += s.total;
        const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`; }).join("; ");
        dataRows.push([formatDate(s.date), s.buyerName || "-", s.sellerName || "-", itemsList, formatCurrency(s.total), formatDate(s.creditDueDate)]);
      });
      dataRows.push([]);
      dataRows.push(["", "", "", "", "ยอดรวมลูกหนี้ทั้งหมด (บาท)", formatCurrency(totalCredit)]);
      const ws = XLSX.utils.aoa_to_sheet(dataRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "รายงานลูกหนี้");
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "binary" });
      function s2ab(s) { const buf = new ArrayBuffer(s.length); const view = new Uint8Array(buf); for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff; return buf; }
      const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
      const fileName = `Credit_Summary_${periodName}_${new Date().getTime()}.xlsx`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
    },
    
    // 15.10 Build Transfer Summary HTML
    buildTransferSummaryHtml(context) {
      const { transferData } = context;
      const { filteredTransferSales, sellerName, startDate, endDate, summaryTimestamp } = transferData;
      const formatCurrency = (num) => this.formatNumberSmart(num);
      const formatDate = (dateStr) => this.formatThaiDateShortYear(dateStr);
      let totalTransfer = 0;
      let transferRows = "";
      filteredTransferSales.forEach((s) => {
        totalTransfer += s.total;
        const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`; }).join(", ");
        transferRows += `<tr><td data-label="วันที่">${formatDate(s.date)}</td><td data-label="ผู้โอน">${s.transferorName || "-"}</td><td data-label="ผู้ขาย">${s.sellerName || "-"}</td><td data-label="รายการ">${itemsList}</td><td data-label="ยอดเงิน (บาท)">${formatCurrency(s.total)}</td></tr>`;
      });
      const periodLine = `<p style="font-size:0.9em; color: #333; font-weight: bold; margin-bottom: 8px;">ช่วงเวลา: ${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}</p>`;
      return `<div style="text-align:center;"><h2>สรุปรายการเงินโอนของ: ${sellerName}</h2><p style="font-size:0.8em; color:#555; margin-bottom: 0;">สรุปเมื่อ: ${summaryTimestamp}</p>${periodLine}<table class="transfer-details-table" style="margin-top: 15px;"><thead><tr><th>วันที่</th><th>ผู้โอน</th><th>ผู้ขาย</th><th>รายการ</th><th>ยอดเงิน (บาท)</th></tr></thead><tbody>${transferRows}</tbody></table><p style="text-align:right; font-size:1.2em; font-weight:bold; margin-top:15px;">ยอดรวมเงินโอนทั้งหมด: ${formatCurrency(totalTransfer)} บาท</p></div>`;
    },
    
    // 15.11 Export Transfer Summary to XLSX
    exportTransferSummaryToXlsx(context) {
      const { transferData, periodName } = context;
      const { filteredTransferSales, sellerName, startDate, endDate, summaryTimestamp } = transferData;
      let dataRows = [];
      const formatCurrency = (num) => this.formatNumberSmart(num);
      const formatDate = (dateStr) => this.formatThaiDateFullYear(dateStr);
      const periodString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;
      dataRows.push(["สรุปโดย:", this.currentUser.username]);
      dataRows.push(["สรุปเมื่อ:", summaryTimestamp]);
      dataRows.push([`สรุปรายการเงินโอนของ ${sellerName}:`, periodString]);
      dataRows.push([]);
      dataRows.push(["วันที่", "ผู้โอน", "ผู้ขาย", "รายการสินค้า", "ยอดเงิน (บาท)"]);
      let totalTransfer = 0;
      filteredTransferSales.forEach((s) => {
        totalTransfer += s.total;
        const itemsList = s.items.map((item) => { const product = this.data.products.find(p => p.id === item.productId); const unit = product ? product.unit : "หน่วย"; return `${item.name}(${this.formatNumberSmart(item.quantity)} ${unit})`; }).join("; ");
        dataRows.push([formatDate(s.date), s.transferorName || "-", s.sellerName || "-", itemsList, formatCurrency(s.total)]);
      });
      dataRows.push([]);
      dataRows.push(["", "", "", "ยอดรวมเงินโอนทั้งหมด (บาท)", formatCurrency(totalTransfer)]);
      const ws = XLSX.utils.aoa_to_sheet(dataRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "รายงานเงินโอน");
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "binary" });
      function s2ab(s) { const buf = new ArrayBuffer(s.length); const view = new Uint8Array(buf); for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff; return buf; }
      const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
      const fileName = `Transfer_Summary_${periodName}_${new Date().getTime()}.xlsx`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
    },
    
    // 15.12 Export Sales History to XLSX
    exportSalesHistoryToXlsx() {
      const startDateStr = document.getElementById("export-sales-start-date").value;
      const endDateStr = document.getElementById("export-sales-end-date").value;
      if (!startDateStr || !endDateStr) {
        this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "warning");
        return;
      }
      const startDate = new Date(startDateStr);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateStr);
      endDate.setHours(23, 59, 59, 999);
      if (startDate > endDate) {
        this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error");
        return;
      }
      const filteredSales = this.data.sales.filter((sale) => { const saleDate = new Date(sale.date); return saleDate >= startDate && saleDate <= endDate; });
      if (filteredSales.length === 0) {
        this.showToast("ไม่พบรายการขายในช่วงวันที่ที่เลือก", "info");
        return;
      }
      filteredSales.sort((a, b) => new Date(b.date) - new Date(a.date));
      let dataRows = [];
      dataRows.push(["วันที่", "เวลา", "รายการสินค้า", "ราคาต่อหน่วย", "จำนวน", "ราคารวมต่อรายการ", "ยอดขายรวม (บาท)", "กำไรรวม (บาท)", "ประเภทชำระ", "รายละเอียดชำระ", "กำหนดชำระ", "ผู้ขาย", "ร้านค้า"]);
      filteredSales.forEach((sale) => {
        const saleDate = new Date(sale.date);
        const dateString = this.formatThaiDateFullYear(sale.date);
        const timeString = `${String(saleDate.getHours()).padStart(2, "0")}:${String(saleDate.getMinutes()).padStart(2, "0")}`;
        let paymentDetail = "-";
        if (sale.paymentMethod === "เครดิต") paymentDetail = sale.buyerName || "-";
        else if (sale.paymentMethod === "เงินโอน") paymentDetail = sale.transferorName || "-";
        const dueDateString = this.formatThaiDateFullYear(sale.creditDueDate);
        sale.items.forEach((item, index) => {
          const itemTotal = item.price * item.quantity;
          const row = [index === 0 ? dateString : "", index === 0 ? timeString : "", item.name + (item.isSpecialPrice ? " (พิเศษ)" : ""), this.formatNumberSmart(item.price), this.formatNumberSmart(item.quantity), this.formatNumberSmart(itemTotal), index === 0 ? this.formatNumberSmart(sale.total) : "", index === 0 ? this.formatNumberSmart(sale.profit) : "", index === 0 ? sale.paymentMethod || "เงินสด" : "", index === 0 ? paymentDetail : "", index === 0 ? dueDateString : "", index === 0 ? sale.sellerName || "-" : "", index === 0 ? sale.storeName || "-" : ""];
          dataRows.push(row);
        });
      });
      const ws = XLSX.utils.aoa_to_sheet(dataRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ประวัติการขาย");
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "binary" });
      function s2ab(s) { const buf = new ArrayBuffer(s.length); const view = new Uint8Array(buf); for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff; return buf; }
      const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
      const fileName = `Sales_History_${startDateStr}_to_${endDateStr}.xlsx`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      this.showToast(`ส่งออกไฟล์ Excel '${fileName}' สำเร็จ`);
    },

    // =================================================================
    // 16. AUTO REPORT (TELEGRAM)
    // =================================================================
    
    // 16.1 Render Auto Report Page
    renderAutoReportPage() {
      const container = document.getElementById("page-auto-report");
      if (!container) return;
      const cfg = this.data.autoReport || { enabled: false, sendTime: "21:00", chatId: "", botToken: "", reportDateMode: "0", sellerMode: "all", sellerIds: [], reportFormat: "image", lastSentDate: "", lastSentDateTime: "" };
      const statusText = cfg.enabled ? "<span style='color:var(--success-color); font-weight:bold;'>🟢 เปิดใช้งานระบบแล้ว</span>" : "<span style='color:var(--danger-color); font-weight:bold;'>🔴 ปิดใช้งานอยู่</span>";
      let dateModeText = "วันนี้ (0)";
      if (cfg.reportDateMode === "1" || cfg.reportDateMode === "yesterday") dateModeText = "ย้อนหลัง 1 วัน (เมื่อวาน)";
      else if (cfg.reportDateMode !== "0" && cfg.reportDateMode !== "today") dateModeText = `ย้อนหลัง ${cfg.reportDateMode} วัน`;
      let sellerModeText = "ผู้ขายทุกคนในระบบ";
      if (cfg.sellerMode === "specific" && cfg.sellerIds && cfg.sellerIds.length > 0) {
        const names = cfg.sellerIds.map(id => { const u = this.data.users.find(x => x.id == id); return u ? u.username : "ไม่ทราบชื่อ"; }).join(", ");
        sellerModeText = `<span style="color:#007bff; font-weight:bold;">เฉพาะ: ${names}</span>`;
      } else if (cfg.sellerMode === "specific") sellerModeText = "<span style='color:red;'>ยังไม่ได้เลือกผู้ขาย (กรุณาแก้ไข)</span>";
      const chatIdText = cfg.chatId ? cfg.chatId : "<span style='color:red;'>ยังไม่ได้ระบุ Chat ID</span>";
      const botTokenText = cfg.botToken ? "✅ ตรวจพบรหัส Bot แล้ว (ซ่อนไว้)" : "❌ ยังไม่ได้ระบุ Bot Token";
      let formatText = "ส่งเป็นรูปภาพ 🖼️";
      if (cfg.reportFormat === "text") formatText = "ส่งเป็นข้อความ 📝";
      if (cfg.reportFormat === "both") formatText = "ทั้งรูปภาพและข้อความ 🖼️📝";
      const sellers = this.data.users.filter(u => u.role === "seller");
      let sellerCheckboxes = "";
      sellers.forEach(seller => {
        const isChecked = cfg.sellerMode === "specific" && cfg.sellerIds.includes(seller.id);
        sellerCheckboxes += `<label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; background: #fff; padding: 5px; border: 1px solid #ddd; border-radius: 4px;"><input type="checkbox" class="auto-report-seller-checkbox" value="${seller.id}" ${isChecked ? "checked" : ""}> <span>${seller.username}</span></label>`;
      });
      container.innerHTML = `<div class="auto-report-settings" style="max-width: 750px; margin: 0 auto;"><h2 style="text-align:center; color: #333;">📤 จัดการระบบส่งรายงานอัตโนมัติ</h2><div style="background-color: #f0f8ff; border: 1px solid #b8daff; border-radius: 8px; padding: 20px; margin-bottom: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);"><h3 style="margin-top: 0; color: #004085; font-size: 1.1em; border-bottom: 2px solid #b8daff; padding-bottom: 10px; display:flex; justify-content:space-between; align-items:center;"><span>📋 รายละเอียดการตั้งค่าที่บันทึกไว้</span><span style="font-size:0.8em; font-weight:normal; color:#666;">(เช็คเงื่อนไขที่นี่ก่อนระบบทำงาน)</span></h3><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; font-size: 0.95em;"><div style="background: #fff; padding: 12px; border-radius: 6px; border-left: 4px solid ${cfg.enabled ? '#28a745' : '#dc3545'};"><span style="color:#666; font-size:0.9em;">สถานะการทำงาน:</span><br> ${statusText}</div><div style="background: #fff; padding: 12px; border-radius: 6px; border-left: 4px solid #ffc107;"><span style="color:#666; font-size:0.9em;">เวลาส่งออก (ทุกวัน):</span><br> <span style="font-size:1.2em; font-weight:bold; color:#d32f2f;">⏰ ${cfg.sendTime} น.</span></div><div style="background: #fff; padding: 12px; border-radius: 6px; border-left: 4px solid #17a2b8;"><span style="color:#666; font-size:0.9em;">รูปแบบการส่ง:</span><br> <span style="font-weight:bold;">${formatText}</span></div><div style="background: #fff; padding: 12px; border-radius: 6px; border-left: 4px solid #6f42c1;"><span style="color:#666; font-size:0.9em;">ดึงยอดขายของวันที่:</span><br> <span style="font-weight:bold;">${dateModeText}</span></div><div style="background: #fff; padding: 12px; border-radius: 6px; border-left: 4px solid #e83e8c;"><span style="color:#666; font-size:0.9em;">สรุปยอดของพนักงาน:</span><br> ${sellerModeText}</div><div style="background: #fff; padding: 12px; border-radius: 6px; border-left: 4px solid #17a2b8; grid-column: 1 / -1;"><span style="color:#666; font-size:0.9em;">ส่งไปที่ (Chat IDs):</span><br> <span style="word-break: break-all; font-weight:bold;">${chatIdText}</span></div></div><div style="background:#fff3cd; padding:12px; border-radius:6px; margin-top:15px; border: 1px dashed #ffeeba; text-align:center;"><b>ประวัติการส่งสำเร็จล่าสุด:</b> <span style="color:#856404; font-weight:bold; font-size: 1.1em;">${cfg.lastSentDateTime ? this.formatThaiTimestamp(cfg.lastSentDateTime) : (cfg.lastSentDate ? this.formatThaiDateFullYear(cfg.lastSentDate) : "ยังไม่มีประวัติการส่ง")}</span></div></div><h3 style="border-bottom: 2px solid #ccc; padding-bottom: 8px; color: #444; margin-top: 30px;">⚙️ ปรับเปลี่ยนเงื่อนไข / แก้ไขการตั้งค่า</h3><div class="setting-group" style="background:#e8f5e9; padding:15px; border:1px solid #c3e6cb; border-radius:6px;"><label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="auto-report-enabled" style="width:25px; height:25px;" ${cfg.enabled ? "checked" : ""}><span style="font-size:1.1em; font-weight:bold; color:#155724;">เปิดให้ระบบรายงานอัตโนมัติทำงาน</span></label></div><div class="setting-group"><label>⏰ 1. แก้ไขเวลาส่งรายงาน</label><input type="time" id="auto-report-time" value="${cfg.sendTime}" style="max-width: 150px; font-size:1.1em; padding: 8px;"></div><div class="setting-group"><label>🤖 2. แก้ไข Bot Token</label><input type="text" id="auto-report-bot-token" value="${cfg.botToken}" placeholder="ใส่ Bot Token เช่น 123456:ABCdef..."><small style="color:#28a745;">${botTokenText}</small></div><div class="setting-group"><label>💬 3. แก้ไขปลายทาง (Chat ID)</label><input type="text" id="auto-report-chat-id" value="${cfg.chatId}" placeholder="ใส่ Chat ID (ถ้ามีหลายเป้าหมายให้คั่นด้วยลูกน้ำ , )"><small style="color: #666;">👉 ส่งเดี่ยว: 123456789 | ส่งกลุ่ม: -100987654321 | ส่งหลายที่: 123456, -100987</small></div><div class="setting-group"><label>📅 4. แก้ไขเงื่อนไขวันที่ดึงข้อมูล (0=วันนี้, 1=เมื่อวาน)</label><div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;"><input type="number" id="auto-report-date-mode" min="0" value="${(cfg.reportDateMode === 'today' ? 0 : (cfg.reportDateMode === 'yesterday' ? 1 : (cfg.reportDateMode || 0)))}" style="max-width: 150px;"><span id="auto-report-date-preview" style="font-size: 1.05em; font-weight: bold; color: #007bff; background: #e9ecef; padding: 5px 10px; border-radius: 4px;"></span></div></div><div class="setting-group"><label>👥 5. แก้ไขเป้าหมายพนักงานที่จะสรุป</label><select id="auto-report-seller-mode" style="padding: 8px; font-size: 1em;"><option value="all" ${cfg.sellerMode === "all" ? "selected" : ""}>สรุปรวมผู้ขายทุกคนในระบบ</option><option value="specific" ${cfg.sellerMode === "specific" ? "selected" : ""}>ระบุตัวบุคคล (คลิกเพื่อเลือกด้านล่าง)</option></select></div><div id="auto-report-seller-list-container" class="setting-group" style="display: ${cfg.sellerMode === "specific" ? "block" : "none"}; background:#f9f9f9; padding:15px; border-radius:6px; border:1px dashed #007bff;"><label style="margin-bottom:8px; border-bottom:1px solid #ccc; padding-bottom:5px; color:#007bff;">✅ ติ๊กเลือกผู้ขายที่ต้องการให้สรุปยอด:</label><div id="auto-report-seller-list" class="seller-list" style="border:none; padding:0; background:transparent; max-height:200px;">${sellerCheckboxes}</div>${sellers.length === 0 ? '<p style="color:#999; text-align:center;">ยังไม่มีผู้ขายในระบบ</p>' : ''}</div><div class="setting-group"><label>📄 6. รูปแบบการส่งรายงาน</label><select id="auto-report-format" style="padding: 8px; font-size: 1em;"><option value="image" ${cfg.reportFormat !== "text" && cfg.reportFormat !== "both" ? "selected" : ""}>ส่งเป็นรูปภาพ (ค่าเริ่มต้น)</option><option value="text" ${cfg.reportFormat === "text" ? "selected" : ""}>ส่งเป็นข้อความ (Text)</option><option value="both" ${cfg.reportFormat === "both" ? "selected" : ""}>ส่งทั้งรูปภาพและข้อความ</option></select></div><hr style="margin: 30px 0; border-color: #ddd;"><div class="form-actions" style="justify-content: center; gap: 15px; flex-wrap: wrap;"><button id="save-auto-report-settings" class="success" style="padding: 12px 25px; font-size: 1em; box-shadow: 0 4px 6px rgba(40,167,69,0.3);">💾 บันทึกการเปลี่ยนแปลง</button><button id="test-auto-report-now" style="background-color: #ff9800; padding: 12px 25px; font-size: 1em; box-shadow: 0 4px 6px rgba(255,152,0,0.3);">📨 ส่งทันที</button><button id="clear-auto-report-settings" class="danger" style="padding: 12px 25px; font-size: 1em; box-shadow: 0 4px 6px rgba(220,53,69,0.3);">🗑️ ลบทิ้งและปิดระบบ</button></div></div>`;
      const sellerModeSelect = document.getElementById("auto-report-seller-mode");
      const sellerListContainer = document.getElementById("auto-report-seller-list-container");
      if (sellerModeSelect) sellerModeSelect.addEventListener("change", (e) => { sellerListContainer.style.display = e.target.value === "specific" ? "block" : "none"; });
      const dateModeInput = document.getElementById("auto-report-date-mode");
      const datePreviewSpan = document.getElementById("auto-report-date-preview");
      const updateDatePreview = () => {
        if (!dateModeInput || !datePreviewSpan) return;
        let offsetDays = parseInt(dateModeInput.value, 10);
        if (isNaN(offsetDays) || offsetDays < 0) offsetDays = 0;
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - offsetDays);
        let prefixText = "";
        if (offsetDays === 0) prefixText = "วันนี้";
        else if (offsetDays === 1) prefixText = "เมื่อวาน";
        else prefixText = `ย้อนหลัง ${offsetDays} วัน`;
        datePreviewSpan.innerHTML = `👉 ดึงข้อมูลของ: <span>${prefixText}</span> <span style="color:#d32f2f;">(${this.formatThaiDateFullYear(targetDate)})</span>`;
      };
      if (dateModeInput) { updateDatePreview(); dateModeInput.addEventListener("input", updateDatePreview); }
      const saveBtn = document.getElementById("save-auto-report-settings");
      if (saveBtn) saveBtn.addEventListener("click", () => this.saveAutoReportSettings());
      const testBtn = document.getElementById("test-auto-report-now");
      if (testBtn) testBtn.addEventListener("click", async () => { try { this.showToast("กำลังประมวลผลการส่ง... (มือถืออาจใช้เวลา 5-10 วินาที)", "warning"); await this.sendAutoReport(true); this.data.autoReport.lastSentDateTime = new Date().toISOString(); this.saveData(); this.showToast("ส่งรายงานสำเร็จแล้ว!", "success"); this.renderAutoReportPage(); } catch (err) { console.error(err); alert("เกิดข้อผิดพลาดบนมือถือ: " + err.message); this.showToast("ส่งรายงานล้มเหลว: " + err.message, "error"); } });
      const clearBtn = document.getElementById("clear-auto-report-settings");
      if (clearBtn) clearBtn.addEventListener("click", () => { if (confirm("🚨 คำเตือน: คุณต้องการ 'ลบทิ้ง' ข้อมูลการตั้งค่าระบบ Auto Report ทั้งหมด และปิดการทำงาน ใช่หรือไม่?")) { this.data.autoReport = { enabled: false, sendTime: "21:00", chatId: "", botToken: "", reportDateMode: "0", sellerMode: "all", sellerIds: [], reportFormat: "image", lastSentDate: "", lastSentDateTime: "" }; this.saveData(); this.renderAutoReportPage(); this.showToast("ลบทิ้งการตั้งค่าเรียบร้อยแล้ว ระบบถูกปิดการใช้งาน", "success"); } });
    },
    
    // 16.2 Save Auto Report Settings
    saveAutoReportSettings() {
      const enabled = document.getElementById("auto-report-enabled")?.checked || false;
      const sendTime = document.getElementById("auto-report-time")?.value || "21:00";
      const botToken = document.getElementById("auto-report-bot-token")?.value || "";
      const chatId = document.getElementById("auto-report-chat-id")?.value || "";
      const reportDateMode = document.getElementById("auto-report-date-mode")?.value || "0";
      const sellerMode = document.getElementById("auto-report-seller-mode")?.value || "all";
      const reportFormat = document.getElementById("auto-report-format")?.value || "image";
      let sellerIds = [];
      if (sellerMode === "specific") { const checkboxes = document.querySelectorAll(".auto-report-seller-checkbox:checked"); checkboxes.forEach(cb => { sellerIds.push(cb.value); }); }
      this.data.autoReport = { enabled, sendTime, chatId, botToken, reportDateMode, sellerMode, sellerIds, reportFormat, lastSentDate: this.data.autoReport?.lastSentDate || "", lastSentDateTime: this.data.autoReport?.lastSentDateTime || "" };
      this.saveData();
      this.showToast("บันทึกการตั้งค่า Auto Report เรียบร้อย", "success");
      this.renderAutoReportPage();
    },
    
    // 16.3 Check Auto Report
    async checkAutoReport() {
      const cfg = this.data.autoReport;
      if (!cfg?.enabled) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const currentTime = `${hh}:${mm}`;
      if(currentTime < cfg.sendTime) return;
      const today = now.toISOString().split('T')[0];
      if(cfg.lastSentDate === today) return;
      try {
        await this.sendAutoReport(false);
        cfg.lastSentDate = today;
        await this.saveData();
        console.log("ส่งรายงานอัตโนมัติสำเร็จ");
        this.showToast("ส่งรายงานอัตโนมัติสำเร็จ", "success");
      } catch(err) {
        console.error("Auto report error:", err);
        this.showToast("ส่งรายงานอัตโนมัติล้มเหลว: " + err.message, "error");
      }
    },
    
    // 16.4 Send Auto Report
    async sendAutoReport(isTest = false) {
      const cfg = this.data.autoReport;
      if (!cfg.botToken || !cfg.chatId) throw new Error("กรุณาตั้งค่า Bot Token และ Chat ID ก่อน");
      let startDate;
      let endDate;
      let offsetDays = parseInt(cfg.reportDateMode, 10);
      if (isNaN(offsetDays)) { if (cfg.reportDateMode === "yesterday") offsetDays = 1; else offsetDays = 0; }
      startDate = new Date();
      startDate.setDate(startDate.getDate() - offsetDays);
      startDate.setHours(0,0,0,0);
      endDate = new Date(startDate);
      endDate.setHours(23,59,59,999);
      let sellerId = null;
      if (cfg.sellerMode === "specific" && cfg.sellerIds && cfg.sellerIds.length > 0) {
        if (cfg.sellerIds.length === 1) sellerId = cfg.sellerIds[0];
        else sellerId = "all";
      }
      let summaryResult;
      if (cfg.sellerMode === "specific" && cfg.sellerIds && cfg.sellerIds.length > 1) {
        summaryResult = { grandTotalSales: 0, grandTotalProfit: 0, grandTotalCash: 0, grandTotalCredit: 0, grandTotalTransfer: 0, salesCount: 0, sellerSummary: {}, totalSellingDays: 0 };
        for (const sid of cfg.sellerIds) {
          const result = this.generatePosSummaryData(startDate, endDate, sid);
          summaryResult.grandTotalSales += result.grandTotalSales;
          summaryResult.grandTotalProfit += result.grandTotalProfit;
          summaryResult.grandTotalCash += result.grandTotalCash;
          summaryResult.grandTotalCredit += result.grandTotalCredit;
          summaryResult.grandTotalTransfer += result.grandTotalTransfer;
          summaryResult.salesCount += result.salesCount;
          for (const [sellerKey, sellerVal] of Object.entries(result.sellerSummary)) {
            if (!summaryResult.sellerSummary[sellerKey]) summaryResult.sellerSummary[sellerKey] = sellerVal;
            else {
              summaryResult.sellerSummary[sellerKey].totalSales += sellerVal.totalSales;
              summaryResult.sellerSummary[sellerKey].totalProfit += sellerVal.totalProfit;
              summaryResult.sellerSummary[sellerKey].totalCash += sellerVal.totalCash;
              summaryResult.sellerSummary[sellerKey].totalCredit += sellerVal.totalCredit;
              summaryResult.sellerSummary[sellerKey].totalTransfer += sellerVal.totalTransfer;
              for (const [prodKey, prodVal] of Object.entries(sellerVal.productSummary)) {
                if (!summaryResult.sellerSummary[sellerKey].productSummary[prodKey]) summaryResult.sellerSummary[sellerKey].productSummary[prodKey] = prodVal;
                else {
                  const existing = summaryResult.sellerSummary[sellerKey].productSummary[prodKey];
                  existing.cashQty += prodVal.cashQty;
                  existing.creditQty += prodVal.creditQty;
                  existing.transferQty += prodVal.transferQty;
                  existing.totalQty += prodVal.totalQty;
                  existing.totalValue += prodVal.totalValue;
                }
              }
            }
          }
        }
        summaryResult.totalSellingDays = Object.keys(summaryResult.sellerSummary).length || 1;
      } else if (cfg.sellerMode === "specific" && cfg.sellerIds && cfg.sellerIds.length === 1) {
        summaryResult = this.generatePosSummaryData(startDate, endDate, cfg.sellerIds[0]);
      } else {
        summaryResult = this.generatePosSummaryData(startDate, endDate, null);
      }
      let targetSellerIds = [];
      if (cfg.sellerMode === "specific" && cfg.sellerIds && cfg.sellerIds.length > 0) targetSellerIds = cfg.sellerIds;
      else targetSellerIds = this.data.users.filter(u => u.role === "seller").map(u => u.id);
      targetSellerIds.forEach(sid => {
        const user = this.data.users.find(u => u.id == sid);
        if (user) {
          if (!summaryResult.sellerSummary[sid]) summaryResult.sellerSummary[sid] = { sellerName: user.username, totalSales: 0, totalProfit: 0, totalCash: 0, totalCredit: 0, totalTransfer: 0, productSummary: {} };
          const assignedIds = user.assignedProductIds || [];
          const sellerProducts = this.data.products.filter(p => assignedIds.includes(p.id));
          sellerProducts.forEach(p => {
            if (!summaryResult.sellerSummary[sid].productSummary[p.id]) summaryResult.sellerSummary[sid].productSummary[p.id] = { name: p.name, stock: p.stock, unit: p.unit, cashQty: 0, creditQty: 0, transferQty: 0, totalQty: 0, totalValue: 0 };
          });
        }
      });
      const stockAsOfData = this.calculateStockAsOf(endDate);
      const stockAsOfDateMap = new Map();
      stockAsOfData.forEach((item) => { stockAsOfDateMap.set(item.name, item.stock); });
      const isSingleDay = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth() && startDate.getDate() === endDate.getDate();
      const thaiDateString = isSingleDay ? this.formatThaiDateFullYear(startDate) : `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;
      let title = isTest ? "📨 ส่งรายงานอัตโนมัติ" : "📊 รายงานยอดขายอัตโนมัติ";
      if (sellerId && sellerId !== "all") { const u = this.data.users.find(x => x.id == sellerId); if (u) title = isTest ? `📨 ส่งรายงานอัตโนมัติ (${u.username})` : `สรุปยอดขาย (${u.username})`; }
      const textMessage = this.buildTextReportMessage(summaryResult, thaiDateString, title, isTest);
      const html = this.buildPosSummaryHtml({ summaryResult, title: title, thaiDateString: thaiDateString, startDate, endDate, stockAsOfDate: stockAsOfDateMap, sellerIdFilter: sellerId });
      const reportFormat = cfg.reportFormat || "image";
      const chatIds = cfg.chatId.split(',').map(id => id.trim()).filter(id => id !== "");
      if (chatIds.length === 0) throw new Error("Chat ID ไม่ถูกต้อง");
      let hasSuccess = false;
      let lastError = "";
      for (let i = 0; i < chatIds.length; i++) {
        const currentChatId = chatIds[i];
        console.log(`กำลังส่งรายงานไปยังเป้าหมายที่ ${i + 1}/${chatIds.length} (ID: ${currentChatId})`);
        if (reportFormat === "text" || reportFormat === "both") {
          try { await this.sendTelegramMessage(currentChatId, textMessage); console.log(`ส่งข้อความไปที่ ${currentChatId} สำเร็จ`); hasSuccess = true; } catch (err) { console.error(`Error sending text to ${currentChatId}:`, err); lastError = err.message; }
        }
        if (reportFormat === "image" || reportFormat === "both") {
          try { const imageBlob = await this.createReportImage(html); await this.sendTelegramPhoto(currentChatId, imageBlob); console.log(`ส่งรูปภาพไปที่ ${currentChatId} สำเร็จ`); hasSuccess = true; } catch (err) { console.error(`Error sending image to ${currentChatId}:`, err); lastError = err.message; }
        }
        if (i < chatIds.length - 1) { console.log("⏳ รอ 5 วินาทีก่อนส่งเป้าหมายต่อไป..."); await new Promise(resolve => setTimeout(resolve, 5000)); }
      }
      if (!hasSuccess) throw new Error(lastError || "ส่งรายงานไม่สำเร็จ กรุณาตรวจสอบการตั้งค่า");
    },
    
    // 16.5 Build Text Report Message
    buildTextReportMessage(summaryResult, thaiDateString, title, isTest) {
      const formatCurrency = (num) => this.formatNumberSmart(num);
      const dateTime = this.formatThaiTimestamp(new Date());
      let message = `📊 *${title}*\n📅 วันที่: ${thaiDateString}\n🕐 สรุปเมื่อ: ${dateTime}\n━━━━━━━━━━━━━━━━━━━━\n\n💰 *สรุปยอดขายรวม*\n💵 เงินสด: ${formatCurrency(summaryResult.grandTotalCash)} บาท\n🏦 เงินโอน: ${formatCurrency(summaryResult.grandTotalTransfer)} บาท\n📝 เครดิต: ${formatCurrency(summaryResult.grandTotalCredit)} บาท\n━┉┉┉┉┉┉┉┉┉┉┉┉━\n✨ *ยอดขายรวมทั้งสิ้น:* ${formatCurrency(summaryResult.grandTotalSales)} บาท\n`;
      if (summaryResult.grandTotalProfit !== undefined) { const profitColor = summaryResult.grandTotalProfit >= 0 ? "✅" : "⚠️"; message += `${profitColor} *กำไรสุทธิ:* ${formatCurrency(summaryResult.grandTotalProfit)} บาท\n`; }
      message += `📊 จำนวนรายการขาย: ${summaryResult.salesCount} ครั้ง\n`;
      const sellerKeys = Object.keys(summaryResult.sellerSummary);
      if (sellerKeys.length > 0) {
        message += `\n━━━━━━━━━━━━━━━━━━━━\n👥 *รายละเอียดแยกตามผู้ขาย*\n`;
        for (const sellerId of sellerKeys) {
          const seller = summaryResult.sellerSummary[sellerId];
          message += `\n▫️ *${seller.sellerName}*\n   ยอดขาย: ${formatCurrency(seller.totalSales)} บาท\n   (เงินสด ${formatCurrency(seller.totalCash)} | โอน ${formatCurrency(seller.totalTransfer)} | เครดิต ${formatCurrency(seller.totalCredit)})\n`;
          const user = this.data.users.find(u => u.id == sellerId);
          if (user && user.role === "seller" && user.commissionRate > 0) {
            let commissionBase = 0;
            if (user.commissionOnCash) commissionBase += seller.totalCash;
            if (user.commissionOnTransfer) commissionBase += seller.totalTransfer;
            if (user.commissionOnCredit) commissionBase += seller.totalCredit;
            const commission = commissionBase * (user.commissionRate / 100);
            message += `   💸 คอมมิชชั่น (${user.commissionRate}%): ${formatCurrency(commission)} บาท\n`;
          } else if (seller.totalProfit !== undefined) message += `   📈 กำไร: ${formatCurrency(seller.totalProfit)} บาท\n`;
        }
      }
      if (isTest) message += `\n━━━━━━━━━━━━━━━━━━━━\n🧪 *นี่คือข้อความทดสอบระบบ*\nหากได้รับข้อความนี้ แสดงว่าระบบ Auto Report ทำงานปกติ ✅\n`;
      message += `\n━━━━━━━━━━━━━━━━━━━━\n🤖 *ระบบรายงานอัตโนมัติ*`;
      return message;
    },
    
    // 16.6 Send Telegram Message
    async sendTelegramMessage(chatId, message) {
      const cfg = this.data.autoReport;
      const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown", disable_web_page_preview: true }) });
      const result = await response.json();
      if (!result.ok) throw new Error(result.description || "ส่งข้อความไม่สำเร็จ");
      return result;
    },
    
    // 16.7 Create Report Image
    async createReportImage(html) {
      const tempDiv = document.createElement("div");
      tempDiv.style.position = "absolute";
      tempDiv.style.top = "0";
      tempDiv.style.left = "0";
      tempDiv.style.zIndex = "-9999";
      tempDiv.style.width = "800px";
      tempDiv.style.visibility = "visible";
      tempDiv.style.opacity = "1";
      tempDiv.style.height = "auto";
      tempDiv.style.maxHeight = "none";
      tempDiv.style.overflow = "visible";
      tempDiv.style.overflowY = "visible";
      tempDiv.style.backgroundColor = "#FAFAD2";
      tempDiv.style.color = "#333";
      tempDiv.style.padding = "20px";
      tempDiv.style.boxSizing = "border-box";
      tempDiv.style.fontFamily = "'Sarabun', 'Prompt', sans-serif";
      tempDiv.classList.add("modal-content-container");
      tempDiv.innerHTML = `<style>.modal-content-container { max-height: none !important; overflow: visible !important; height: auto !important; } #modalBodyContent { width: 100%; text-align: center; max-height: none !important; overflow: visible !important; padding-bottom: 20px !important; } #modalBodyContent > div { width: 100%; margin: 0 auto !important; max-height: none !important; overflow: visible !important; } #modalBodyContent table { margin: 0 auto !important; width: 95%; max-width: 760px; background-color: #fff; border-collapse: collapse; margin-bottom: 20px !important; } #modalBodyContent th, #modalBodyContent td { border: 1px solid #ccc; padding: 8px; } #modalBodyContent th { background-color: #f4f4f4; color: #007bff; font-weight: bold; }</style><div id="modalBodyContent" style="padding: 0;">${html}<div style="height: 20px; width: 100%; clear: both;"></div></div>`;
      document.body.appendChild(tempDiv);
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (typeof html2canvas === 'undefined') throw new Error("ระบบตรวจไม่พบ Library สำหรับสร้างรูปภาพ (html2canvas)");
        const borderSize = 2;
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const canvasScale = isMobile ? 2 : 4;
        const canvas = await html2canvas(tempDiv, { scale: canvasScale, useCORS: true, allowTaint: true, backgroundColor: "#FAFAD2", logging: false, width: 800, windowWidth: 800, height: tempDiv.offsetHeight });
        document.body.removeChild(tempDiv);
        const finalCanvas = document.createElement("canvas");
        const finalCtx = finalCanvas.getContext("2d");
        finalCanvas.width = canvas.width + (borderSize * 2);
        finalCanvas.height = canvas.height + (borderSize * 2);
        finalCtx.fillStyle = "#FFFFFF";
        finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        finalCtx.drawImage(canvas, borderSize, borderSize);
        const blob = await new Promise((resolve, reject) => { finalCanvas.toBlob(b => { if (b) resolve(b); else reject(new Error("สร้างไฟล์รูปภาพไม่สำเร็จ (Canvas Empty)")); }, "image/png"); });
        return blob;
      } catch (err) { if (tempDiv.parentNode) document.body.removeChild(tempDiv); throw err; }
    },
    
    // 16.8 Send Telegram Photo
    async sendTelegramPhoto(chatId, blob) {
      const cfg = this.data.autoReport;
      const url = `https://api.telegram.org/bot${cfg.botToken}/sendPhoto`;
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", blob, "report.png");
      const response = await fetch(url, { method: "POST", body: formData });
      const result = await response.json();
      if (!result.ok) throw new Error(result.description || "ส่งรูปภาพไม่สำเร็จ");
      return result;
    },

    // =================================================================
    // 17. SUMMARY MODAL & OUTPUT
    // =================================================================
    
    // 17.1 Open Summary Modal
    openSummaryModal(htmlContent) {
      const modal = document.getElementById("summaryModal");
      const modalBody = document.getElementById("modalBodyContent");
      modalBody.innerHTML = htmlContent;
      modal.style.display = "flex";
      this.setupSummaryPopupControls();
    },
    
    // 17.2 Close Summary Modal
    closeSummaryModal() {
      document.getElementById("summaryModal").style.display = "none";
    },
    
    // 17.3 Open Summary Output Modal
    openSummaryOutputModal() {
      document.getElementById("summaryOutputModal").style.display = "flex";
    },
    
    // 17.4 Close Summary Output Modal
    closeSummaryOutputModal() {
      document.getElementById("summaryOutputModal").style.display = "none";
      this.summaryContext = {};
    },
    
    // 17.5 Setup Summary Popup Controls
    setupSummaryPopupControls() {
      const modalContentContainer = document.querySelector("#summaryModal .modal-content-container");
      const modalBody = document.getElementById("modalBodyContent");
      if (!modalBody || !modalContentContainer) return;
      const textElements = modalBody.querySelectorAll("p, h2, h3, h4, strong, th, td, span, div");
      const fsSlider = document.getElementById("summaryFontSizeSlider");
      const fsValueSpan = document.getElementById("summaryFontSizeValue");
      textElements.forEach((el) => { if (!el.dataset.originalSize) el.dataset.originalSize = parseFloat(window.getComputedStyle(el).fontSize); });
      const updateFontSize = () => { const scale = fsSlider.value; textElements.forEach((el) => { const originalSize = parseFloat(el.dataset.originalSize); if (originalSize) el.style.fontSize = originalSize * scale + "px"; }); fsValueSpan.textContent = "ขนาด: " + Math.round(scale * 100) + "%"; };
      fsSlider.removeEventListener("input", updateFontSize);
      fsSlider.addEventListener("input", updateFontSize);
      const lhSlider = document.getElementById("summaryLineHeightSlider");
      const lhValueSpan = document.getElementById("summaryLineHeightValue");
      const updateLineHeight = () => { const lineHeight = lhSlider.value; modalBody.style.lineHeight = lineHeight; lhValueSpan.textContent = "ความสูงของบรรทัด: " + lineHeight; };
      lhSlider.removeEventListener("input", updateLineHeight);
      lhSlider.addEventListener("input", updateLineHeight);
      const shareBtn = document.getElementById("shareSummaryImageBtn");
      const newShareBtn = shareBtn.cloneNode(true);
      shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
      newShareBtn.addEventListener("click", async () => {
        const pinkFrame = modalBody;
        if (!pinkFrame) { this.showToast("ไม่พบเนื้อหาสำหรับแชร์", "error"); return; }
        const controlsElement = modalContentContainer.querySelector(".modal-controls");
        if (controlsElement) controlsElement.style.display = "none";
        try {
          const canvas = await html2canvas(pinkFrame, { scale: 2, useCORS: true, backgroundColor: "#FAFAD2" });
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          const file = new File([blob], `POS_Summary_${Date.now()}.png`, { type: "image/png" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
          else this.showToast("อุปกรณ์นี้ไม่รองรับการแชร์รูป", "warning");
        } catch (err) { console.error(err); this.showToast("แชร์รูปไม่สำเร็จ", "error"); } finally { if (controlsElement) controlsElement.style.display = ""; }
      });
      const saveBtn = document.getElementById("saveSummaryAsImageBtn");
      const newSaveBtn = saveBtn.cloneNode(true);
      saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
      newSaveBtn.addEventListener("click", () => {
        const pinkFrame = modalBody;
        if (!pinkFrame) { this.showToast("ไม่พบเนื้อหาสรุปสำหรับบันทึก", "error"); return; }
        const controlsElement = modalContentContainer.querySelector(".modal-controls");
        if (controlsElement) controlsElement.style.display = "none";
        const originalStyles = { modalContentContainerMargin: modalContentContainer.style.margin, modalContentContainerBoxSizing: modalContentContainer.style.boxSizing, modalContentContainerMaxWidth: modalContentContainer.style.maxWidth, modalBodyMaxHeight: pinkFrame.style.maxHeight, modalBodyOverflowY: pinkFrame.style.overflowY, modalBodyBoxSizing: pinkFrame.style.boxSizing, modalBodyPadding: pinkFrame.style.padding };
        pinkFrame.style.maxHeight = "none";
        pinkFrame.style.overflowY = "visible";
        pinkFrame.style.boxSizing = "content-box";
        modalContentContainer.style.maxWidth = "none";
        modalContentContainer.style.margin = "2px";
        modalContentContainer.style.boxSizing = "content-box";
        html2canvas(pinkFrame, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: "#FAFAD2", logging: false }).then((canvas) => {
          const finalCanvas = document.createElement("canvas");
          const finalCtx = finalCanvas.getContext("2d");
          const borderSize = 2;
          finalCanvas.width = canvas.width + borderSize * 2;
          finalCanvas.height = canvas.height + borderSize * 2;
          finalCtx.fillStyle = "#FFFFFF";
          finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
          finalCtx.drawImage(canvas, borderSize, borderSize);
          const link = document.createElement("a");
          const fileName = `POS_Summary_${this.currentUser.username}_${Date.now()}.png`;
          link.download = fileName;
          link.href = finalCanvas.toDataURL("image/png");
          link.click();
          this.showToast("บันทึกรูปภาพเรียบร้อยแล้ว", "success");
        }).catch((err) => { console.error("Error creating image:", err); this.showToast("ขออภัย, ไม่สามารถบันทึกเป็นรูปภาพได้: " + err.message, "error"); }).finally(() => { if (controlsElement) controlsElement.style.display = ""; pinkFrame.style.maxHeight = originalStyles.modalBodyMaxHeight; pinkFrame.style.overflowY = originalStyles.modalBodyOverflowY; pinkFrame.style.boxSizing = originalStyles.modalBodyBoxSizing; pinkFrame.style.padding = originalStyles.modalBodyPadding; modalContentContainer.style.margin = originalStyles.modalContentContainerMargin; modalContentContainer.style.boxSizing = originalStyles.modalContentContainerBoxSizing; modalContentContainer.style.maxWidth = originalStyles.modalContentContainerMaxWidth; });
      });
      updateFontSize();
      updateLineHeight();
    },
    
    // 17.6 Handle Summary Output
    handleSummaryOutput(choice) {
      if (!this.summaryContext || !this.summaryContext.type) { this.closeSummaryOutputModal(); return; }
      let htmlGenerator, excelExporter;
      switch (this.summaryContext.type) {
        case "detailed_list": htmlGenerator = () => this.buildDetailedListHtml(this.summaryContext); excelExporter = () => this.exportDetailedListToXlsx(this.summaryContext); break;
        case "credit": htmlGenerator = () => this.buildCreditSummaryHtml(this.summaryContext); excelExporter = () => this.exportCreditSummaryToXlsx(this.summaryContext); break;
        case "transfer": htmlGenerator = () => this.buildTransferSummaryHtml(this.summaryContext); excelExporter = () => this.exportTransferSummaryToXlsx(this.summaryContext); break;
        default: htmlGenerator = () => this.buildPosSummaryHtml(this.summaryContext); excelExporter = () => this.exportPosSummaryToXlsx(this.summaryContext); break;
      }
      if (choice === "display") { const html = htmlGenerator(); this.openSummaryModal(html); }
      else if (choice === "excel") excelExporter();
      else if (choice === "pdf") { const html = htmlGenerator(); const printContainer = document.getElementById("print-container"); if (printContainer) { printContainer.innerHTML = html; window.print(); } }
      this.closeSummaryOutputModal();
    },

    // =================================================================
    // 18. ADMIN QUICK SUMMARY METHODS
    // =================================================================
    
    _runSummary(startDate, endDate, title, periodName, sellerId = null, extraContext = {}) {
      const summaryResult = this.generatePosSummaryData(startDate, endDate, sellerId);
      if (summaryResult.salesCount === 0) { this.showToast("ไม่พบข้อมูลการขายในช่วงที่กำหนด"); return; }
      const stockAsOfData = this.calculateStockAsOf(endDate);
      const stockAsOfDateMap = new Map();
      stockAsOfData.forEach((item) => { stockAsOfDateMap.set(item.name, item.stock); });
      const isSingleDay = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth() && startDate.getDate() === endDate.getDate();
      const thaiDateString = isSingleDay ? this.formatThaiDateShortYear(startDate) : `${this.formatThaiDateShortYear(startDate)} ถึง ${this.formatThaiDateShortYear(endDate)}`;
      const dateString = `${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`;
      this.summaryContext = { type: "aggregated_pos", summaryResult, title, dateString, thaiDateString, periodName, sellerIdFilter: sellerId, startDate, endDate, stockAsOfDate: stockAsOfDateMap };
      Object.assign(this.summaryContext, extraContext);
      this.openSummaryOutputModal();
    },
    
    _getAdminReportFilters() {
      const sellerId = document.getElementById("summary-seller-select").value;
      const startDateStr = document.getElementById("summary-custom-start-date").value;
      const endDateStr = document.getElementById("summary-custom-end-date").value;
      if (!startDateStr || !endDateStr) { this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error"); return null; }
      const startDate = new Date(startDateStr); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateStr); endDate.setHours(23, 59, 59, 999);
      if (startDate > endDate) { this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error"); return null; }
      const selectedUser = this.data.users.find((u) => u.id == sellerId);
      const sellerName = sellerId === "all" ? "ผู้ขายทั้งหมด" : selectedUser ? selectedUser.username : "ไม่พบผู้ขาย";
      return { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName };
    },
    
    _getAdminQuickSummaryFilters() {
      const sellerId = document.getElementById("summary-seller-select").value;
      const selectedUser = this.data.users.find((u) => u.id == sellerId);
      const sellerName = sellerId === "all" ? "ผู้ขายทั้งหมด" : selectedUser ? selectedUser.username : "ไม่พบผู้ขาย";
      return { sellerId, sellerName };
    },
    
    filterSalesData(startDate, endDate, sellerId, paymentTypes) {
      return this.data.sales.filter((sale) => { const saleDate = new Date(sale.date); if (saleDate < startDate || saleDate > endDate) return false; if (sellerId !== "all" && sale.sellerId != sellerId) return false; const paymentMethod = sale.paymentMethod || "เงินสด"; if (!paymentTypes.includes(paymentMethod)) return false; return true; }).sort((a, b) => new Date(b.date) - new Date(a.date));
    },
    
    runAdminDetailedReport() {
      const filters = this._getAdminReportFilters(); if (!filters) return;
      const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;
      const selectedPaymentTypes = Array.from(document.querySelectorAll("#summary-payment-types input:checked")).map((cb) => cb.value);
      if (selectedPaymentTypes.length === 0) { this.showToast("กรุณาเลือกข้อมูลที่จะสรุปอย่างน้อย 1 ประเภท", "error"); return; }
      const filteredSales = this.filterSalesData(startDate, endDate, sellerId, selectedPaymentTypes);
      if (filteredSales.length === 0) { this.showToast("ไม่พบข้อมูลการขายตามเงื่อนไขที่กำหนด"); return; }
      const thaiDateString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;
      const title = `รายงานการขายของ ${sellerName}`;
      const periodName = `Detailed_Report_${sellerId}_${startDateStr}_to_${endDateStr}`;
      this.summaryContext = { type: "detailed_list", filteredSales, title, thaiDateString, periodName, sellerId: sellerId };
      this.openSummaryOutputModal();
    },
    
    runAdminCreditSummary() {
      const filters = this._getAdminReportFilters(); if (!filters) return;
      const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;
      const filteredCreditSales = this.data.sales.filter((s) => { if (s.paymentMethod !== "เครดิต") return false; const saleDate = new Date(s.date); if (saleDate < startDate || saleDate > endDate) return false; if (sellerId !== "all" && s.sellerId != sellerId) return false; return true; });
      if (filteredCreditSales.length === 0) { this.showToast("ไม่พบข้อมูลลูกหนี้ (เครดิต) ในช่วงเวลาที่เลือก", "warning"); return; }
      const summaryTimestamp = this.formatThaiTimestamp(new Date());
      this.summaryContext = { type: "credit", creditData: { filteredCreditSales: filteredCreditSales.sort((a, b) => new Date(b.date) - new Date(a.date)), sellerName: sellerName, startDate, endDate, summaryTimestamp }, title: `สรุปรายการลูกหนี้ของ ${sellerName}`, periodName: `Credit_Admin_${sellerId}_${startDateStr}_to_${endDateStr}` };
      this.openSummaryOutputModal();
    },
    
    runAdminTransferSummary() {
      const filters = this._getAdminReportFilters(); if (!filters) return;
      const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;
      const filteredTransferSales = this.data.sales.filter((s) => { if (s.paymentMethod !== "เงินโอน") return false; const saleDate = new Date(s.date); if (saleDate < startDate || saleDate > endDate) return false; if (sellerId !== "all" && s.sellerId != sellerId) return false; return true; });
      if (filteredTransferSales.length === 0) { this.showToast("ไม่พบข้อมูลเงินโอนในช่วงเวลาที่เลือก", "warning"); return; }
      const summaryTimestamp = this.formatThaiTimestamp(new Date());
      this.summaryContext = { type: "transfer", transferData: { filteredTransferSales: filteredTransferSales.sort((a, b) => new Date(b.date) - new Date(a.date)), sellerName: sellerName, startDate, endDate, summaryTimestamp }, title: `สรุปรายการเงินโอนของ ${sellerName}`, periodName: `Transfer_Admin_${sellerId}_${startDateStr}_to_${endDateStr}` };
      this.openSummaryOutputModal();
    },
    
    runAdminSummaryByCustomRange() {
      const filters = this._getAdminReportFilters(); if (!filters) return;
      const { sellerId, startDate, endDate, startDateStr, endDateStr, sellerName } = filters;
      const title = `สรุปภาพรวม: ${sellerName}`;
      const periodName = `Aggregated_${sellerId}_${startDateStr}_to_${endDateStr}`;
      this._runSummary(startDate, endDate, title, periodName, sellerId);
    },
    
    runAdminSummaryToday() {
      const filters = this._getAdminQuickSummaryFilters(); if (!filters) return;
      const { sellerId, sellerName } = filters;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const title = `สรุปยอดขายวันนี้ (${sellerName})`;
      const periodName = `Admin_Today_${sellerId}`;
      this._runSummary(todayStart, todayEnd, title, periodName, sellerId);
    },
    
    runAdminSummaryByDay() {
      const filters = this._getAdminQuickSummaryFilters(); if (!filters) return;
      const { sellerId, sellerName } = filters;
      const dateStr = document.getElementById("admin-summary-date").value;
      if (!dateStr) { this.showToast("กรุณาเลือกวันที่", "warning"); return; }
      const startDate = new Date(dateStr); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateStr); endDate.setHours(23, 59, 59, 999);
      const title = `สรุปยอดขายวันที่ ${this.formatThaiDateFullYear(startDate)} (${sellerName})`;
      const periodName = `Admin_Day_${dateStr}_${sellerId}`;
      this._runSummary(startDate, endDate, title, periodName, sellerId);
    },
    
    runAdminSummaryAll() {
      const filters = this._getAdminQuickSummaryFilters(); if (!filters) return;
      const { sellerId, sellerName } = filters;
      let relevantSales = this.data.sales;
      if (sellerId !== "all") relevantSales = this.data.sales.filter((s) => s.sellerId == sellerId);
      if (relevantSales.length === 0) { this.showToast(`ไม่พบข้อมูลการขายสำหรับ ${sellerName}`); return; }
      const allDates = relevantSales.map((s) => new Date(s.date));
      const startDate = new Date(Math.min.apply(null, allDates)); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(Math.max.apply(null, allDates)); endDate.setHours(23, 59, 59, 999);
      const timeDiff = endDate.getTime() - startDate.getTime();
      const dayCount = Math.round(timeDiff / (1000 * 3600 * 24));
      const title = `สรุปยอดขายทั้งหมด (${sellerName})`;
      const periodName = `Admin_All_${sellerId}`;
      this._runSummary(startDate, endDate, title, periodName, sellerId, { dayCount });
    },

    // =================================================================
    // 19. SELLER SUMMARY METHODS
    // =================================================================
    
    runSellerDetailedReport() {
      const startDateStr = document.getElementById("seller-report-start-date").value;
      const endDateStr = document.getElementById("seller-report-end-date").value;
      const selectedPaymentTypes = Array.from(document.querySelectorAll("#seller-report-payment-types input:checked")).map((cb) => cb.value);
      if (!startDateStr || !endDateStr) { this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error"); return; }
      const startDate = new Date(startDateStr); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateStr); endDate.setHours(23, 59, 59, 999);
      if (startDate > endDate) { this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error"); return; }
      if (selectedPaymentTypes.length === 0) { this.showToast("กรุณาเลือกประเภทการชำระเงินอย่างน้อย 1 อย่าง", "error"); return; }
      const filteredSales = this.filterSalesData(startDate, endDate, this.currentUser.id, selectedPaymentTypes);
      if (filteredSales.length === 0) { this.showToast("ไม่พบข้อมูลการขายตามเงื่อนไขที่กำหนด"); return; }
      const thaiDateString = `${this.formatThaiDateFullYear(startDate)} ถึง ${this.formatThaiDateFullYear(endDate)}`;
      const title = `รายงานการขายของ ${this.currentUser.username}`;
      const periodName = `Seller_Detailed_Report_${this.currentUser.username}_${startDateStr}_to_${endDateStr}`;
      this.summaryContext = { type: "detailed_list", filteredSales, title, thaiDateString, periodName, sellerId: this.currentUser.id };
      this.openSummaryOutputModal();
    },
    
    runSellerCreditSummary() {
      const startDateStr = document.getElementById("seller-credit-start-date").value;
      const endDateStr = document.getElementById("seller-credit-end-date").value;
      if (!startDateStr || !endDateStr) { this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error"); return; }
      const startDate = new Date(startDateStr); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateStr); endDate.setHours(23, 59, 59, 999);
      if (startDate > endDate) { this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error"); return; }
      const filteredCreditSales = this.data.sales.filter((s) => { if (s.sellerId !== this.currentUser.id || s.paymentMethod !== "เครดิต") return false; const saleDate = new Date(s.date); return saleDate >= startDate && saleDate <= endDate; });
      if (filteredCreditSales.length === 0) { this.showToast("ไม่พบข้อมูลลูกหนี้ (เครดิต) ในช่วงเวลาที่เลือก", "warning"); return; }
      const summaryTimestamp = this.formatThaiTimestamp(new Date());
      this.summaryContext = { type: "credit", creditData: { filteredCreditSales: filteredCreditSales.sort((a, b) => new Date(b.date) - new Date(a.date)), sellerName: this.currentUser.username, startDate, endDate, summaryTimestamp }, title: `สรุปรายการลูกหนี้ของ ${this.currentUser.username}`, periodName: `Credit_Seller_${this.currentUser.id}_${startDateStr}_to_${endDateStr}` };
      this.openSummaryOutputModal();
    },
    
    runSellerTransferSummary() {
      const startDateStr = document.getElementById("seller-transfer-start-date").value;
      const endDateStr = document.getElementById("seller-transfer-end-date").value;
      if (!startDateStr || !endDateStr) { this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error"); return; }
      const startDate = new Date(startDateStr); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateStr); endDate.setHours(23, 59, 59, 999);
      if (startDate > endDate) { this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error"); return; }
      const filteredTransferSales = this.data.sales.filter((s) => { if (s.sellerId !== this.currentUser.id || s.paymentMethod !== "เงินโอน") return false; const saleDate = new Date(s.date); return saleDate >= startDate && saleDate <= endDate; });
      if (filteredTransferSales.length === 0) { this.showToast("ไม่พบข้อมูลเงินโอนในช่วงเวลาที่เลือก", "warning"); return; }
      const summaryTimestamp = this.formatThaiTimestamp(new Date());
      this.summaryContext = { type: "transfer", transferData: { filteredTransferSales: filteredTransferSales.sort((a, b) => new Date(b.date) - new Date(a.date)), sellerName: this.currentUser.username, startDate, endDate, summaryTimestamp }, title: `สรุปรายการเงินโอนของ ${this.currentUser.username}`, periodName: `Transfer_Seller_${this.currentUser.id}_${startDateStr}_to_${endDateStr}` };
      this.openSummaryOutputModal();
    },
    
    summarizeMyToday() {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      this._runSummary(todayStart, todayEnd, `สรุปยอดขายวันนี้ (${this.currentUser.username})`, `MyToday`, this.currentUser.id);
    },
    
    summarizeMyDay() {
      const dateStr = document.getElementById("my-summary-date").value;
      if (!dateStr) { this.showToast("กรุณาเลือกวันที่", "warning"); return; }
      const startDate = new Date(dateStr); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateStr); endDate.setHours(23, 59, 59, 999);
      this._runSummary(startDate, endDate, `สรุปยอดขายวันที่เลือก (${this.currentUser.username})`, `MyDate_${dateStr}`, this.currentUser.id);
    },
    
    summarizeMyRange() {
      const startDateStr = document.getElementById("my-summary-start-date").value;
      const endDateStr = document.getElementById("my-summary-end-date").value;
      if (!startDateStr || !endDateStr) { this.showToast("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "error"); return; }
      const startDate = new Date(startDateStr); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateStr); endDate.setHours(23, 59, 59, 999);
      if (startDate > endDate) { this.showToast("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด", "error"); return; }
      const timeDiff = endDate.getTime() - startDate.getTime();
      const dayCount = Math.round(timeDiff / (1000 * 3600 * 24));
      const title = `สรุปยอดขายตามช่วงวันที่ (${this.currentUser.username})`;
      const periodName = `MyRange_${startDateStr}_to_${endDateStr}`;
      this._runSummary(startDate, endDate, title, periodName, this.currentUser.id, { dayCount });
    },
    
    summarizeMyAll() {
      const mySales = this.data.sales.filter((s) => s.sellerId === this.currentUser.id);
      if (mySales.length === 0) { this.showToast("คุณยังไม่มีข้อมูลการขาย"); return; }
      const allMyDates = mySales.map((s) => new Date(s.date));
      const startDate = new Date(Math.min.apply(null, allMyDates)); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(Math.max.apply(null, allMyDates)); endDate.setHours(23, 59, 59, 999);
      const timeDiff = endDate.getTime() - startDate.getTime();
      const dayCount = Math.round(timeDiff / (1000 * 3600 * 24));
      this._runSummary(startDate, endDate, `สรุปยอดขายทั้งหมด (${this.currentUser.username})`, `MyAll`, this.currentUser.id, { dayCount });
    },

    // =================================================================
    // 20. RENDER DATA (LEGACY METHOD)
    // =================================================================
    
    renderData(colName) {
      if (!this.currentUser) return;
      const isAdmin = this.currentUser.role === "admin";
      const activeSection = document.querySelector(".section-content.active");
      if (!activeSection) return;
      const activePageId = activeSection.id;
      switch (colName) {
        case "products":
          if (activePageId === "page-products" && isAdmin) this.renderProductTable();
          if (activePageId === "page-pos") this.renderPos();
          break;
        case "sales":
          if (isAdmin) {
            if (activePageId === "page-sales-history") this.renderSalesHistory();
            if (activePageId === "page-reports") this.renderReport();
          }
          break;
        case "users":
          if (activePageId === "page-users" && isAdmin) this.renderUserTable();
          break;
        case "stockIns":
          if (activePageId === "page-stock-in" && isAdmin) this.renderStockIn();
          break;
        case "stockOuts":
          if (activePageId === "page-stock-out" && isAdmin) this.renderStockOut();
          break;
        case "stores":
          if (activePageId === "page-stores" && isAdmin) this.renderStoreTable();
          break;
        case "pos/data":
          if (activePageId === "page-products" && isAdmin) this.renderProductTable();
          if (activePageId === "page-pos") this.renderPos();
          if (activePageId === "page-sales-history" && isAdmin) this.renderSalesHistory();
          if (activePageId === "page-reports" && isAdmin) this.renderReport();
          if (activePageId === "page-users" && isAdmin) this.renderUserTable();
          if (activePageId === "page-stock-in" && isAdmin) this.renderStockIn();
          if (activePageId === "page-stock-out" && isAdmin) this.renderStockOut();
          if (activePageId === "page-stores" && isAdmin) this.renderStoreTable();
          break;
      }
    },

    // =================================================================
    // 21. EVENT LISTENERS
    // =================================================================
    
    attachEventListeners() {
      const loginForm = document.getElementById("login-form");
      if (loginForm) loginForm.addEventListener("submit", (e) => { e.preventDefault(); this.login(document.getElementById("username").value, document.getElementById("password").value); });
      const logoutBtn = document.getElementById("logout-btn");
      if (logoutBtn) logoutBtn.addEventListener("click", () => this.logout());
// ปุ่มซิงค์ข้อมูล
      const syncBtn = document.getElementById("sync-data-btn");
      if (syncBtn) syncBtn.addEventListener("click", () => this.manualSync());
      const mainApp = document.getElementById("main-app");
      if (mainApp) {
        mainApp.addEventListener("submit", (e) => {
          if (e.target.id === "add-to-cart-form") { e.preventDefault(); this.addToCart(e); }
          if (e.target.id === "product-form") { e.preventDefault(); this.saveProduct(e); }
          if (e.target.id === "store-form") { e.preventDefault(); this.saveStore(e); }
          if (e.target.id === "stock-in-form") { e.preventDefault(); this.saveStockIn(e); }
          if (e.target.id === "stock-out-form") { e.preventDefault(); this.saveStockOut(e); }
          if (e.target.id === "report-filter-form") { e.preventDefault(); this.renderReport(e); }
          if (e.target.id === "user-form") { e.preventDefault(); this.saveUser(e); }
          if (e.target.id === "seller-sales-filter-form") { e.preventDefault(); this.renderSellerSalesHistoryWithFilter(); }
          if (e.target.id === "seller-detailed-report-form") { e.preventDefault(); this.runSellerDetailedReport(); }
          if (e.target.id === "seller-credit-report-form") { e.preventDefault(); this.runSellerCreditSummary(); }
          if (e.target.id === "seller-transfer-report-form") { e.preventDefault(); this.runSellerTransferSummary(); }
          if (e.target.id === "backup-password-form") { e.preventDefault(); this.saveBackupPassword(e); }
        });
        mainApp.addEventListener("click", (e) => {
          if (e.target.id === "process-sale-btn") this.processSale();
          if (e.target.classList.contains("remove-from-cart-btn")) this.removeFromCart(e.target.dataset.index);
          if (e.target.id === "toggle-special-price-btn") this.toggleSpecialPrice();
          if (e.target.classList.contains("edit-sale-btn")) this.editSale(e.target.dataset.id);
          if (e.target.classList.contains("delete-sale-btn")) { this.deleteSale(e.target.dataset.id); this.renderSalesHistory(); }
          if (e.target.classList.contains("seller-delete-sale-btn")) { if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบรายการขายนี้? สต็อกสินค้าจะถูกคืนเข้าระบบ")) { this.deleteSale(e.target.dataset.id); this.renderSellerSalesHistoryWithFilter(); } }
          if (e.target.id === "load-from-file-btn") document.getElementById("data-file-input").click();
          if (e.target.id === "save-to-file-btn") this.showExportOptionsModal();
          if (e.target.id === "save-to-browser-btn" || e.target.id === "save-to-browser-btn-seller") this.manualSaveToBrowser();
          if (e.target.id === "open-reset-modal-btn") this.openResetModal();
          if (e.target.id === "clear-tombstones-btn") this.clearAllTombstones();
          if (e.target.id === "generate-stock-report-btn") this.renderStockSummaryReport();
          if (e.target.id === "generate-yesterday-stock-report-btn") this.renderYesterdayStockSummaryReport();
          if (e.target.id === "recalculate-stock-btn") this.handleRecalculateStock();
          if (e.target.id === "clear-product-form-btn") { document.getElementById("product-form").reset(); document.getElementById("product-id").value = ""; }
          if (e.target.classList.contains("edit-product-btn")) this.editProduct(e.target.dataset.id);
          if (e.target.classList.contains("delete-product-btn")) this.deleteProduct(e.target.dataset.id);
          if (e.target.classList.contains("edit-stock-in-btn")) this.editStockIn(e.target.dataset.id);
          if (e.target.classList.contains("delete-stock-in-btn")) this.deleteStockIn(e.target.dataset.id);
          if (e.target.id === "clear-stock-in-form-btn") this.clearStockInForm();
          if (e.target.classList.contains("edit-stock-out-btn")) this.editStockOut(e.target.dataset.id);
          if (e.target.classList.contains("delete-stock-out-btn")) this.deleteStockOut(e.target.dataset.id);
          if (e.target.id === "clear-stock-out-form-btn") this.clearStockOutForm();
          if (e.target.id === "clear-store-form-btn") { document.getElementById("store-form").reset(); document.getElementById("store-id").value = ""; }
          if (e.target.classList.contains("edit-store-btn")) this.editStore(e.target.dataset.id);
          if (e.target.classList.contains("delete-store-btn")) this.deleteStore(e.target.dataset.id);
          if (e.target.id === "clear-user-form-btn") this.setupUserForm();
          if (e.target.classList.contains("edit-user-btn")) this.editUser(e.target.dataset.id);
          if (e.target.classList.contains("delete-user-btn")) this.deleteUser(e.target.dataset.id);
          if (e.target.id === "export-sales-history-excel-btn") this.exportSalesHistoryToXlsx();
          if (e.target.id === "admin-summary-today-btn") this.runAdminSummaryToday();
          if (e.target.id === "admin-summary-by-day-btn") this.runAdminSummaryByDay();
          if (e.target.id === "admin-summary-all-btn") this.runAdminSummaryAll();
          if (e.target.id === "generate-aggregated-summary-btn") this.runAdminSummaryByCustomRange();
          if (e.target.id === "generate-detailed-report-btn") this.runAdminDetailedReport();
          if (e.target.id === "generate-credit-summary-btn") this.runAdminCreditSummary();
          if (e.target.id === "generate-transfer-summary-btn") this.runAdminTransferSummary();
          if (e.target.id === "my-summary-today-btn") this.summarizeMyToday();
          if (e.target.id === "my-summary-by-day-btn") this.summarizeMyDay();
          if (e.target.id === "my-summary-by-range-btn") this.summarizeMyRange();
          if (e.target.id === "my-summary-all-btn") this.summarizeMyAll();
          if (e.target.id === "save-to-file-btn-seller") { this.saveBackupToFile(); }
          if (e.target.id === "save-to-browser-btn-seller") { this.manualSaveToBrowser(); }
          const collapsibleBar = e.target.closest(".collapsible-bar");
          if (collapsibleBar) {
            const targetId = collapsibleBar.dataset.target;
            const content = document.getElementById(targetId);
            if (content) {
              collapsibleBar.classList.toggle("active");
              content.classList.toggle("active");
              const arrow = collapsibleBar.querySelector(".arrow");
              if (arrow) arrow.style.transform = content.classList.contains("active") ? "rotate(90deg)" : "rotate(0deg)";
            }
          }
        });
        mainApp.addEventListener("change", (e) => {
          if (e.target.id === "pos-date" || e.target.id === "pos-time") this.posTimeManuallyChanged = true;
          if (e.target.name === "payment-method") this.togglePaymentDetailFields();
          if (e.target.name === "seller-filter-type") {
            const filterType = e.target.value;
            const dateDiv = document.getElementById("seller-filter-by-date-div");
            const rangeDiv = document.getElementById("seller-filter-by-range-div");
            if (dateDiv) dateDiv.style.display = "none";
            if (rangeDiv) rangeDiv.style.display = "none";
            if (filterType === "by_date" && dateDiv) { dateDiv.style.display = "block"; const dateInput = document.getElementById("seller-filter-date"); if(dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0]; }
            else if (filterType === "by_range" && rangeDiv) rangeDiv.style.display = "flex";
          }
          if (e.target.id === "user-role") {
            const isSeller = e.target.value === "seller";
            const displayStyle = isSeller ? "grid" : "none";
            const containers = [document.getElementById("user-product-assignment-container"), document.getElementById("user-sales-period-container"), document.getElementById("user-store-assignment-container"), document.getElementById("user-commission-settings-container"), document.getElementById("user-history-view-container")];
            containers.forEach((el) => { if (el) el.style.display = displayStyle; });
          }
          if (e.target.id === "data-file-input") this.promptLoadFromFile(e);
          if (e.target.id === "pos-product") this.updateSpecialPriceInfo();
          if (["report-start-date", "report-end-date", "report-seller"].includes(e.target.id)) this.renderReport(e);
        });
      }
      const showLoginPassCheckbox = document.getElementById("show-password-login");
      if (showLoginPassCheckbox) showLoginPassCheckbox.addEventListener("change", (e) => { const passwordInput = document.getElementById("password"); if (passwordInput) passwordInput.type = e.target.checked ? "text" : "password"; });
      document.body.addEventListener("change", (e) => {
        if (e.target.id === "show-password-user-form") { document.getElementById("user-password").type = e.target.checked ? "text" : "password"; document.getElementById("user-password-confirm").type = e.target.checked ? "text" : "password"; }
        if (e.target.id === "show-backup-password") { document.getElementById("backup-password").type = e.target.checked ? "text" : "password"; document.getElementById("backup-password-confirm").type = e.target.checked ? "text" : "password"; }
        if (e.target.id === "reset-products-checkbox") { if (e.target.checked) { const cbSales = document.getElementById("reset-sales-checkbox"); const cbStock = document.getElementById("reset-stockins-checkbox"); if (cbSales) cbSales.checked = true; if (cbStock) cbStock.checked = true; } }
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") { const posPage = document.getElementById("page-pos"); if (posPage && posPage.style.display !== "none" && posPage.classList.contains("active")) { e.preventDefault(); const confirmBtn = document.getElementById("process-sale-btn"); if (confirmBtn) confirmBtn.click(); } } });
      const cancelResetBtn = document.getElementById("cancel-reset-btn");
      if (cancelResetBtn) cancelResetBtn.addEventListener("click", () => this.closeResetModal());
      const confirmResetBtn = document.getElementById("confirm-selective-reset-btn");
      if (confirmResetBtn) confirmResetBtn.addEventListener("click", () => this.handleSelectiveReset());
    },
  };

  window.App = App;
  App.init();
});