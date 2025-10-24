import express from "express";
import { conn } from "../dbconnect"; // ปรับ Path ตามโครงสร้างโปรเจกต์ของคุณ
import mysql from "mysql2/promise";
import { ResultSetHeader, RowDataPacket } from "mysql2";
// import bcrypt from 'bcrypt'; // ไม่ใช้ bcrypt ตามคำขอ

// Interface สำหรับข้อมูลที่อยู่ (อาจจะย้ายไปไฟล์ model/address.ts)
interface UserAddress {
    address_id: number;
    address: string;
    latitude: number;
    longitude: number;
}

export const router = express.Router();

// --- ดึงข้อมูลโปรไฟล์ผู้ใช้พร้อมที่อยู่ (และรหัสผ่าน - ไม่ปลอดภัย!) ---
// GET /users/:userId
router.get("/:userId", async (req, res) => {
    const userId = req.params.userId;

    // ตรวจสอบ userId รูปแบบ
    if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({ message: "รูปแบบ User ID ไม่ถูกต้อง" });
    }
    const userIdNum = parseInt(userId);


    let connection: mysql.PoolConnection | undefined;
    try {
        connection = await conn.getConnection();

        // 1. ดึงข้อมูลผู้ใช้ (รวมรหัสผ่าน - ไม่ปลอดภัยอย่างยิ่ง!)
        const [users] = await connection.query<RowDataPacket[]>(
            // ***** คำเตือน: ดึงรหัสผ่านแบบ Plain text มาแสดง *****
            "SELECT user_id, name, phone, profile_image, password FROM users WHERE user_id = ?",
            // **************************************************
            [userIdNum]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
        }
        const userData = users[0];

        // 2. ดึงข้อมูลที่อยู่ทั้งหมดของผู้ใช้
        const [addresses] = await connection.query<RowDataPacket[]>(
            "SELECT address_id, address, latitude, longitude FROM address WHERE user_id = ?",
            [userIdNum]
        );

        // 3. รวมข้อมูลผู้ใช้และที่อยู่
        const userProfile = {
            ...userData,
            addresses: addresses as UserAddress[] // แปลง array ที่ได้ให้เป็น Type UserAddress[]
        };

        // คำเตือน: กำลังส่งรหัสผ่านแบบ Plain text กลับไปให้ Client!
        res.status(200).json(userProfile);

    } catch (error) {
        console.error(`❌ เกิดข้อผิดพลาดในการดึงโปรไฟล์ผู้ใช้ (ID: ${userIdNum}):`, error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลโปรไฟล์", error: error instanceof Error ? error.message : String(error) });
    } finally {
        // คืน Connection กลับสู่ Pool เสมอ
        if (connection) connection.release();
    }
});

// --- อัปเดตข้อมูลโปรไฟล์ผู้ใช้ (รวมรหัสผ่าน ถ้ามี) ---
// PUT /users/:userId
router.put("/:userId", async (req, res) => {
    const userId = req.params.userId;
    // รับข้อมูล name, phone, profileImage, และ newPassword จาก body
    const { name, phone, profileImage, newPassword } = req.body;

     // ตรวจสอบ userId รูปแบบ
    if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({ message: "รูปแบบ User ID ไม่ถูกต้อง" });
    }
    const userIdNum = parseInt(userId);

    // ตรวจสอบข้อมูลพื้นฐาน (ชื่อและเบอร์โทรจำเป็น)
    if (!name || !phone) {
         return res.status(400).json({ message: "กรุณาระบุชื่อและเบอร์โทรศัพท์" });
    }
     // ไม่มีการตรวจสอบความยาวรหัสผ่านตามคำขอ ("ทำง่ายๆพอ")
     // if (newPassword && typeof newPassword === 'string' && newPassword.length < 4) {
     //      return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร" });
     // }


    let connection: mysql.PoolConnection | undefined;
    try {
        connection = await conn.getConnection();
        await connection.beginTransaction(); // เริ่ม Transaction

        // (ทางเลือก) ตรวจสอบว่าเบอร์โทรใหม่ซ้ำกับคนอื่นหรือไม่
         const parsedPhone = parseInt(phone);
         if (isNaN(parsedPhone)) {
             await connection.rollback(); // ยกเลิก Transaction
             return res.status(400).json({ message: "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง" });
         }
         const [existingPhone] = await connection.query<RowDataPacket[]>(
           "SELECT user_id FROM users WHERE phone = ? AND user_id != ?", // เช็คเบอร์โทรที่ไม่ใช่ user ปัจจุบัน
           [parsedPhone, userIdNum]
         );
         if (existingPhone.length > 0) {
             await connection.rollback(); // ยกเลิก Transaction
             return res.status(409).json({ message: "เบอร์โทรศัพท์นี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว" });
         }


        // สร้าง SQL UPDATE แบบ Dynamic (เพิ่ม field ที่ต้องการอัปเดต)
        let sql = "UPDATE users SET ";
        const params: (string | number | null)[] = []; // Array เก็บค่าที่จะใส่ใน SQL
        const setClauses: string[] = []; // Array เก็บส่วน SET ... = ?

        setClauses.push("name = ?"); // เพิ่มการอัปเดตชื่อ
        params.push(name);
        setClauses.push("phone = ?"); // เพิ่มการอัปเดตเบอร์โทร
        params.push(parsedPhone);

        // อัปเดตรูปโปรไฟล์ (อนุญาตให้เป็น null เพื่อลบรูป)
        if (profileImage !== undefined) { // เช็คว่ามีการส่ง profileImage มาหรือไม่ (แม้จะเป็น null)
             setClauses.push("profile_image = ?");
             params.push(profileImage);
        }

        // --- เพิ่มการอัปเดตรหัสผ่าน (ถ้ามีการส่ง newPassword มา) ---
        let passwordUpdateMessage = "";
        // ***** คำเตือน: บันทึกรหัสผ่านแบบ Plain text - ไม่ปลอดภัยอย่างยิ่ง *****
        if (newPassword && typeof newPassword === 'string' && newPassword.length > 0) {
             // ไม่มีการ Hashing ตามคำขอ
             setClauses.push("password = ?");       // เพิ่ม field password = ?
             params.push(newPassword);            // เพิ่ม newPassword (Plain text) ลงใน params
             passwordUpdateMessage = " (รวมรหัสผ่าน)"; // เพิ่มข้อความแจ้งผู้ใช้
             console.log(`Password for user ${userIdNum} will be updated (plain text - INSECURE!).`);
        }
        // *************************************************************


        // ตรวจสอบว่ามี field ให้อัปเดตหรือไม่ (ปกติควรมี name, phone เสมอ)
        if (setClauses.length === 0) {
             await connection.rollback();
             return res.status(400).json({ message: "ไม่มีข้อมูลให้อัปเดต" });
        }

        // รวมส่วน SET ... = ?, ... = ?
        sql += setClauses.join(", ");
        // เพิ่ม WHERE clause
        sql += " WHERE user_id = ?";
        params.push(userIdNum); // เพิ่ม userId เป็น parameter สุดท้าย

        console.log("Executing Update SQL:", sql);
        // console.log("With Params:", params); // หลีกเลี่ยงการ Log รหัสผ่าน

        // สั่ง Execute SQL UPDATE
        const [result] = await connection.query<ResultSetHeader>(sql, params);

        // ตรวจสอบว่ามีการอัปเดตเกิดขึ้นจริงหรือไม่ (ถ้า user_id ไม่มีอยู่ result.affectedRows จะเป็น 0)
        if (result.affectedRows === 0) {
             await connection.rollback();
             return res.status(404).json({ message: "ไม่พบผู้ใช้ที่ต้องการอัปเดต" });
        }

        // ถ้าสำเร็จ ให้ Commit Transaction
        await connection.commit();

        // ดึงข้อมูลผู้ใช้ที่อัปเดตแล้ว (ไม่รวมรหัสผ่าน) เพื่อส่งกลับให้ Frontend
        const [updatedUsers] = await connection.query<RowDataPacket[]>(
             "SELECT user_id, name, phone, profile_image FROM users WHERE user_id = ?",
             [userIdNum]
        );
         // ดึงที่อยู่ของผู้ใช้ (เผื่อ Frontend ต้องการอัปเดตข้อมูลทั้งหมด)
         const [updatedAddresses] = await connection.query<RowDataPacket[]>(
            "SELECT address_id, address, latitude, longitude FROM address WHERE user_id = ?",
            [userIdNum]
        );

        // ส่ง Response กลับ (ตามโครงสร้าง Model ของ Frontend)
        res.status(200).json({
            message: `อัปเดตข้อมูลผู้ใช้สำเร็จ${passwordUpdateMessage}`,
            user: {
                ...updatedUsers[0],
                // ใส่ password ที่อัปเดตแล้วกลับไป (Frontend ต้องการแสดง)
                // *** คำเตือน: ส่ง Password กลับไป ไม่ปลอดภัย ***
                password: newPassword && newPassword.length > 0 ? newPassword : undefined, // ส่ง password ใหม่ถ้ามีการเปลี่ยน, ถ้าไม่เปลี่ยน ไม่ต้องส่ง
                addresses: updatedAddresses as UserAddress[]
            }
         });

    } catch (error) {
        if (connection) await connection.rollback(); // Rollback ถ้าเกิด Error
        console.error(`❌ เกิดข้อผิดพลาดในการอัปเดตโปรไฟล์ (ID: ${userIdNum}):`, error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล", error: error instanceof Error ? error.message : String(error) });
    } finally {
        if (connection) connection.release(); // คืน Connection
    }
});


// --- เส้นทางสำหรับ เพิ่ม/ลบ ที่อยู่ (คงเดิมจาก Response ก่อนหน้า) ---
// POST /users/:userId/addresses
router.post("/:userId/addresses", async (req, res) => {
    // ... (โค้ดเพิ่มที่อยู่) ...
    const userId = req.params.userId;
    const { address, latitude, longitude } = req.body;

    if (!userId || isNaN(parseInt(userId))) return res.status(400).json({ message: "Invalid User ID format" });
    const userIdNum = parseInt(userId);
    if (!address || latitude == null || longitude == null) return res.status(400).json({ message: "กรุณาระบุข้อมูลที่อยู่ให้ครบถ้วน" });

    let connection: mysql.PoolConnection | undefined;
    try {
        connection = await conn.getConnection();
        const [users] = await connection.query<RowDataPacket[]>("SELECT user_id FROM users WHERE user_id = ?", [userIdNum]);
        if (users.length === 0) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

        const [result] = await connection.query<ResultSetHeader>(
            "INSERT INTO address (user_id, address, latitude, longitude) VALUES (?, ?, ?, ?)",
            [userIdNum, address, latitude, longitude]
        );
        const newAddressId = result.insertId;
        if (!newAddressId) throw new Error("Could not insert address");

        const newAddress: UserAddress = { address_id: newAddressId, address, latitude, longitude };
        res.status(201).json({ message: "เพิ่มที่อยู่สำเร็จ", address: newAddress });
    } catch (error) {
        console.error(`❌ Error adding address for user (ID: ${userIdNum}):`, error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการเพิ่มที่อยู่", error: error instanceof Error ? error.message : String(error) });
    } finally {
        if (connection) connection.release();
    }
});

// DELETE /users/addresses/:addressId
router.delete("/addresses/:addressId", async (req, res) => {
     // ... (โค้ดลบที่อยู่) ...
     const addressId = req.params.addressId;
     if (!addressId || isNaN(parseInt(addressId))) return res.status(400).json({ message: "Invalid Address ID format" });
     const addressIdNum = parseInt(addressId);
     // !!! เพิ่มการตรวจสอบสิทธิ์: ที่อยู่นี้เป็นของผู้ใช้ที่ล็อกอินอยู่หรือไม่ !!!
     let connection: mysql.PoolConnection | undefined;
     try {
        connection = await conn.getConnection();
        const [result] = await connection.query<ResultSetHeader>("DELETE FROM address WHERE address_id = ?", [addressIdNum]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "ไม่พบที่อยู่ที่ต้องการลบ" });
        res.status(200).json({ message: "ลบที่อยู่สำเร็จ" });
     } catch (error) {
        console.error(`❌ Error deleting address (ID: ${addressIdNum}):`, error);
         if (error instanceof Error && 'code' in error && error.code === 'ER_ROW_IS_REFERENCED_2') {
             return res.status(400).json({ message: "ไม่สามารถลบที่อยู่นี้ได้ เนื่องจากมีการใช้งานอยู่", code: error.code });
         }
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบที่อยู่", error: error instanceof Error ? error.message : String(error) });
     } finally {
        if (connection) connection.release();
     }
});
// --------------------------------------------------------------------------

