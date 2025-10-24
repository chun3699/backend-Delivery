import express from "express";
import { conn } from "../dbconnect"; // ปรับ Path ตามโครงสร้างโปรเจกต์ของคุณ
import mysql from "mysql2/promise";
import { ResultSetHeader, RowDataPacket } from "mysql2";
// ไม่ใช้ bcrypt

export const router = express.Router();

// --- ดึงข้อมูลโปรไฟล์ไรเดอร์ (รวมรหัสผ่าน - ไม่ปลอดภัย!) ---
// GET /riders/:riderId
router.get("/:riderId", async (req, res) => {
    const riderId = req.params.riderId;

    if (!riderId || isNaN(parseInt(riderId))) {
        return res.status(400).json({ message: "รูปแบบ Rider ID ไม่ถูกต้อง" });
    }
    const riderIdNum = parseInt(riderId);

    let connection: mysql.PoolConnection | undefined;
    try {
        connection = await conn.getConnection();

        // 1. ดึงข้อมูลไรเดอร์ (รวมรหัสผ่าน รูปโปรไฟล์ และรูปรถ/ใบขับขี่)
        const [riders] = await connection.query<RowDataPacket[]>(
            // ***** WARNING: Selecting plain password here *****
            "SELECT rider_id, name, phone, password, profile_image, car_image, car_number FROM rider WHERE rider_id = ?",
            [riderIdNum]
        );

        if (riders.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลไรเดอร์" });
        }

        // WARNING: ส่งรหัสผ่านแบบ Plain text
        res.status(200).json(riders[0]);

    } catch (error) {
        console.error(`❌ เกิดข้อผิดพลาดในการดึงโปรไฟล์ไรเดอร์ (ID: ${riderIdNum}):`, error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลโปรไฟล์", error: error instanceof Error ? error.message : String(error) });
    } finally {
        if (connection) connection.release();
    }
});

// --- อัปเดตข้อมูลโปรไฟล์ไรเดอร์ (รวมรหัสผ่าน ถ้ามี) ---
// PUT /riders/:riderId
router.put("/:riderId", async (req, res) => {
    const riderId = req.params.riderId;
    // รับข้อมูล name, phone, carNumber, profileImage, carImage, และ newPassword
    const { name, phone, carNumber, profileImage, carImage, newPassword } = req.body;

    if (!riderId || isNaN(parseInt(riderId))) {
        return res.status(400).json({ message: "รูปแบบ Rider ID ไม่ถูกต้อง" });
    }
    const riderIdNum = parseInt(riderId);

    if (!name || !phone || !carNumber) {
         return res.status(400).json({ message: "กรุณาระบุชื่อ, เบอร์โทร, และทะเบียนรถ" });
    }
    
    let connection: mysql.PoolConnection | undefined;
    try {
        connection = await conn.getConnection();
        await connection.beginTransaction();

        const parsedPhone = parseInt(phone);
        if (isNaN(parsedPhone)) { await connection.rollback(); return res.status(400).json({ message: "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง" }); }

        // 1. ตรวจสอบเบอร์โทรใหม่ซ้ำ
        const [existingPhone] = await connection.query<RowDataPacket[]>(
           "SELECT rider_id FROM rider WHERE phone = ? AND rider_id != ?",
           [parsedPhone, riderIdNum]
        );
        if (existingPhone.length > 0) {
             await connection.rollback();
             return res.status(409).json({ message: "เบอร์โทรศัพท์นี้ถูกใช้งานโดยไรเดอร์อื่นแล้ว" });
        }


        // 2. สร้าง SQL UPDATE แบบ Dynamic
        let sql = "UPDATE rider SET ";
        const params: (string | number | null)[] = [];
        const setClauses: string[] = []; // <--- ใช้งาน setClauses (ชื่อถูกต้อง)
        let passwordUpdateMessage = "";

        setClauses.push("name = ?"); params.push(name);
        setClauses.push("phone = ?"); params.push(parsedPhone); // <--- แก้ไข: เปลี่ยน setClalices เป็น setClauses
        setClauses.push("car_number = ?"); params.push(carNumber);

        if (profileImage !== undefined) { setClauses.push("profile_image = ?"); params.push(profileImage); }
        if (carImage !== undefined) { setClauses.push("car_image = ?"); params.push(carImage); }
        
        // --- อัปเดตรหัสผ่าน (Plain text) ---
        if (newPassword && typeof newPassword === 'string' && newPassword.length > 0) {
             setClauses.push("password = ?");
             params.push(newPassword); // บันทึก Plain text
             passwordUpdateMessage = " (รวมรหัสผ่าน)";
        }
        // ------------------------------------

        if (setClauses.length === 0) { await connection.rollback(); return res.status(400).json({ message: "ไม่มีข้อมูลให้อัปเดต" }); }

        sql += setClauses.join(", ");
        sql += " WHERE rider_id = ?";
        params.push(riderIdNum);

        const [result] = await connection.query<ResultSetHeader>(sql, params);

        if (result.affectedRows === 0) {
             await connection.rollback(); return res.status(404).json({ message: "ไม่พบไรเดอร์ที่ต้องการอัปเดต" });
        }

        await connection.commit();

        // 3. ดึงข้อมูลที่อัปเดตแล้ว (รวมรหัสผ่าน)
        const [updatedRiders] = await connection.query<RowDataPacket[]>(
             // ดึง password กลับไปด้วยตามที่ Frontend คาดหวัง
             "SELECT rider_id, name, phone, password, profile_image, car_image, car_number FROM rider WHERE rider_id = ?",
             [riderIdNum]
        );

        res.status(200).json({
            message: `อัปเดตข้อมูลไรเดอร์สำเร็จ${passwordUpdateMessage}`,
            // ส่ง object Rider ที่อัปเดตแล้วกลับไป
            rider: updatedRiders[0] 
         });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`❌ เกิดข้อผิดพลาดในการอัปเดตโปรไฟล์ไรเดอร์ (ID: ${riderIdNum}):`, error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล", error: error instanceof Error ? error.message : String(error) });
    } finally {
        if (connection) connection.release();
    }
});
