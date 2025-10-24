import express from "express";
import { conn } from "../dbconnect";
// import { User } from "../model/user"; // ไม่ได้ใช้ User model ในส่วนนี้

import mysql from "mysql2/promise";
// import util from "util"; // ไม่ได้ใช้ util.promisiΩfy
// แก้ไข: Import RowDataPacket และ ResultSetHeader ให้ถูกต้อง
import { ResultSetHeader, RowDataPacket } from "mysql2";

export const router = express.Router();

// -------------------- REGISTER USER (โค้ดเดิม) --------------------
router.post("/user", async (req, res) => {
  // 1. ดึงข้อมูลจาก body (เพิ่ม profileImage)
  const { name, phone, password, address, latitude, longitude, profileImage } = req.body;

  // 2. ตรวจสอบข้อมูลเบื้องต้น (profileImage เป็น optional)
  if (!name || !phone || !password || !address || latitude == null || longitude == null) {
    return res.status(400).json({ message: "กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (ชื่อ, เบอร์, รหัส, ที่อยู่, พิกัด)" });
  }

  let connection: mysql.PoolConnection | undefined;

  try {
    // 3. เริ่ม Transaction
    connection = await conn.getConnection();
    await connection.beginTransaction();

    // 4. ตรวจสอบว่าเบอร์โทรซ้ำในตาราง 'users' หรือไม่
    const [existingUsers] = await connection.query<RowDataPacket[]>( // <--- ใช้ RowDataPacket ที่ Import มา
      "SELECT user_id FROM users WHERE phone = ?",
      [phone]
    );

    if (existingUsers.length > 0) {
      await connection.rollback();
      return res.status(409).json({ message: "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว" });
    }

    // 5. เพิ่มผู้ใช้ใหม่ลงในตาราง 'users' (เพิ่ม profile_image)
    const [userResult] = await connection.query<ResultSetHeader>( // <--- ใช้ ResultSetHeader ที่ Import มา
      "INSERT INTO users (name, phone, password, profile_image) VALUES (?, ?, ?, ?)",
      [name, phone, password, profileImage ?? null] // บันทึก profileImage (ถ้ามี)
    );

    const newUserId = userResult.insertId;
    if (!newUserId) {
      throw new Error("ไม่สามารถสร้างผู้ใช้ใหม่ได้ (No Insert ID)");
    }

    // 6. เพิ่มที่อยู่ลงในตาราง 'address'
    // ไม่จำเป็นต้องระบุ Type generic ที่นี่ เพราะเราไม่ได้ใช้ผลลัพธ์โดยตรง
    await connection.query(
      "INSERT INTO address (user_id, address, latitude, longitude) VALUES (?, ?, ?, ?)",
      [newUserId, address, latitude, longitude]
    );

    // 7. ยืนยัน Transaction
    await connection.commit();

    // 8. ส่งข้อมูลกลับ (มีแค่ message และ userId ตาม Model ล่าสุด)
    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      userId: newUserId,
     });

  } catch (error) {
    // 9. Rollback Transaction ถ้าเกิดข้อผิดพลาด
    if (connection) {
      await connection.rollback();
    }
    console.error("❌ Error in /register/user:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการสมัครสมาชิก", error: (error instanceof Error ? error.message : String(error)) });

  } finally {
    // 10. คืน connection กลับเข้า pool เสมอ
    if (connection) {
      connection.release();
    }
  }
});



// --- อัปเดต Route นี้ ---
// -------------------- REGISTER RIDER --------------------
router.post("/rider", async (req, res) => {
// -----------------------
  try {
    // ดึงข้อมูล รวมถึงรูปภาพ (profileImage, licenseImage)
    const { name, phone, password, car_number, profileImage, licenseImage } = req.body;
    console.log("📥 Register rider request:", req.body); // Log request body ทั้งหมด

    // ตรวจสอบข้อมูลเบื้องต้น (รูปภาพเป็น optional)
     if (!name || !phone || !password || !car_number) { // <-- แก้ชื่อ field เป็น car_number
        return res.status(400).json({ message: "กรุณากรอกข้อมูลไรเดอร์ที่จำเป็นให้ครบถ้วน (ชื่อ, เบอร์, รหัส, ทะเบียนรถ)" });
     }


    // ตรวจสอบเบอร์ซ้ำก่อน
     const [existingRiders] = await conn.query<RowDataPacket[]>( // <--- ใช้ RowDataPacket ที่ Import มา
        "SELECT rider_id FROM rider WHERE phone = ?",
        [phone]
     );

     if (existingRiders.length > 0) {
        return res.status(409).json({ message: "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว (ไรเดอร์)" });
     }


    // แก้ไข SQL ให้เพิ่ม profile_image และ car_image
    const sql = `
      INSERT INTO rider (name, phone, password, profile_image, car_image, car_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `; // <-- แก้ไข SQL

    // เพิ่ม profileImage และ licenseImage ใน parameters
    const [result] = await conn.query<ResultSetHeader>(sql, [ // <--- ใช้ ResultSetHeader ที่ Import มา
      name,
      phone,
      password, // ควร Hash รหัสผ่านก่อนบันทึกจริง
      profileImage ?? null, // <-- เพิ่ม profileImage (ถ้าไม่มีให้เป็น null)
      licenseImage ?? null, // <-- เพิ่ม licenseImage (ถ้าไม่มีให้เป็น null) - สมมติว่า Frontend ส่ง key นี้มา
      car_number,           // <-- แก้ชื่อ field เป็น car_number
    ]);

    res.status(201).json({
      message: "สมัครไรเดอร์สำเร็จ",
      affectedRows: result.affectedRows,
      lastId: result.insertId,
    });
  } catch (error) {
    console.error("❌ Register rider error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการสมัครไรเดอร์", error: (error instanceof Error ? error.message : String(error)) });
  }
});

