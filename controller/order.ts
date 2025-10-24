import express from "express";
import { conn } from "../dbconnect";
import mysql from "mysql2/promise";
import { ResultSetHeader, RowDataPacket } from "mysql2";

export const router = express.Router();

// Interfaces
interface OrderListItem {
  order_id: number;
  item_description: string;
  status: string;
  status_description: string;
  status_date: string | null;
  status_time: string | null;
  other_party_user_id: number;
  other_party_name: string;
  other_party_phone: number;
  other_party_profile_image?: string;
  destination_address: string;
  destination_lat: number;
  destination_lon: number;
  item_image?: string; // <-- field สำหรับรูปสินค้า
}

// Enum สำหรับสถานะ Order
const OrderStatus = {
  WaitingForRider: "1",
  RiderAccepted: "2",
  RiderPickedUp: "3",
  Delivered: "4",
};

// Helper แปลง status เป็นข้อความ
function getStatusDescription(status: string): string {
  switch (status) {
    case "1": return "รอไรเดอร์มารับสินค้า";
    case "2": return "ไรเดอร์รับงานแล้ว";
    case "3": return "กำลังจัดส่ง";
    case "4": return "จัดส่งสำเร็จ";
    default: return "ไม่ทราบสถานะ";
  }
}

// ------------------------
// POST สร้าง Order ใหม่
// ------------------------
router.post("/", async (req, res) => {
  const { sender_id, receiver_id, address_id, item_description, imageUrl } = req.body;

  if (!sender_id || !receiver_id || !address_id || !item_description) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }
  if (sender_id === receiver_id) {
    return res.status(400).json({ message: "ผู้ส่งและผู้รับต้องไม่เหมือนกัน" });
  }

  let connection: mysql.PoolConnection | undefined;
  try {
    connection = await conn.getConnection();
    await connection.beginTransaction();

    // ตรวจสอบ address_id ของ receiver
    const [addressCheck] = await connection.query<RowDataPacket[]>(
      "SELECT address_id FROM address WHERE address_id = ? AND user_id = ?",
      [address_id, receiver_id]
    );
    if (addressCheck.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "ที่อยู่ไม่ตรงกับผู้รับ" });
    }

    // สร้าง Order
    const sql = `
      INSERT INTO \`order\` (sender_id, receiver_id, address_id, rider_id, item_description, date, time, image)
      VALUES (?, ?, ?, NULL, ?, CURDATE(), CURTIME(), ?)
    `;
    const [result] = await connection.query<ResultSetHeader>(sql, [
      sender_id,
      receiver_id,
      address_id,
      item_description,
      imageUrl ?? "",
    ]);
    const newOrderId = result.insertId;

    // เพิ่มสถานะแรก
    const statusSql = `
      INSERT INTO status (order_id, status, image, description, date, time)
      VALUES (?, ?, ?, '', CURDATE(), CURTIME())
    `;
    await connection.query(statusSql, [
      newOrderId,
      OrderStatus.WaitingForRider,
      imageUrl ?? "",
    ]);

    await connection.commit();
    res.status(201).json({ success: true, message: "สร้างรายการจัดส่งสำเร็จ", order_id: newOrderId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการสร้าง Order", error: (error instanceof Error ? error.message : String(error)) });
  } finally {
    if (connection) connection.release();
  }
});

// ------------------------
// GET รายการส่งของ (Sender)
// ------------------------
router.get("/sent/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ message: "Invalid User ID" });

  let connection: mysql.PoolConnection | undefined;
  try {
    connection = await conn.getConnection();
    const [rows] = await connection.query<RowDataPacket[]>(`
      SELECT 
        o.order_id, o.item_description, o.image AS item_image,
        u_receiver.user_id AS other_party_user_id,
        u_receiver.name AS other_party_name,
        u_receiver.phone AS other_party_phone,
        u_receiver.profile_image AS other_party_profile_image,
        s_latest.status, s_latest.date AS status_date, s_latest.time AS status_time,
        a_dest.address AS destination_address,
        a_dest.latitude AS destination_lat,
        a_dest.longitude AS destination_lon
      FROM \`order\` AS o
      JOIN users AS u_receiver ON o.receiver_id = u_receiver.user_id
      LEFT JOIN address AS a_dest ON o.address_id = a_dest.address_id
      LEFT JOIN (
        SELECT order_id, status, date, time
        FROM status s1
        WHERE s1.status_id = (
          SELECT MAX(s2.status_id)
          FROM status s2
          WHERE s1.order_id = s2.order_id
        )
      ) AS s_latest ON o.order_id = s_latest.order_id
      WHERE o.sender_id = ?
      ORDER BY o.order_id DESC
    `, [userId]);

    const result: OrderListItem[] = rows.map(row => ({
      order_id: row.order_id,
      item_description: row.item_description,
      status: row.status ?? "N/A",
      status_description: getStatusDescription(row.status),
      status_date: row.status_date ? new Date(row.status_date).toLocaleDateString("th-TH") : null,
      status_time: row.status_time ?? null,
      other_party_user_id: row.other_party_user_id,
      other_party_name: row.other_party_name,
      other_party_phone: row.other_party_phone,
      other_party_profile_image: row.other_party_profile_image,
      destination_address: row.destination_address ?? "ไม่มีข้อมูลที่อยู่",
      destination_lat: row.destination_lat ?? 0.0,
      destination_lon: row.destination_lon ?? 0.0,
      item_image: row.item_image ?? "",
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงรายการส่งของ", error: (error instanceof Error ? error.message : String(error)) });
  } finally {
    if (connection) connection.release();
  }
});

// ------------------------
// GET รายการรับของ (Receiver)
// ------------------------
router.get("/received/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ message: "Invalid User ID" });

  let connection: mysql.PoolConnection | undefined;
  try {
    connection = await conn.getConnection();
    const [rows] = await connection.query<RowDataPacket[]>(`
      SELECT 
        o.order_id, o.item_description, o.image AS item_image,
        u_sender.user_id AS other_party_user_id,
        u_sender.name AS other_party_name,
        u_sender.phone AS other_party_phone,
        u_sender.profile_image AS other_party_profile_image,
        s_latest.status, s_latest.date AS status_date, s_latest.time AS status_time,
        a_dest.address AS destination_address,
        a_dest.latitude AS destination_lat,
        a_dest.longitude AS destination_lon
      FROM \`order\` AS o
      JOIN users AS u_sender ON o.sender_id = u_sender.user_id
      LEFT JOIN address AS a_dest ON o.address_id = a_dest.address_id
      LEFT JOIN (
        SELECT order_id, status, date, time
        FROM status s1
        WHERE s1.status_id = (
          SELECT MAX(s2.status_id)
          FROM status s2
          WHERE s1.order_id = s2.order_id
        )
      ) AS s_latest ON o.order_id = s_latest.order_id
      WHERE o.receiver_id = ?
      ORDER BY o.order_id DESC
    `, [userId]);

    const result: OrderListItem[] = rows.map(row => ({
      order_id: row.order_id,
      item_description: row.item_description,
      status: row.status ?? "N/A",
      status_description: getStatusDescription(row.status),
      status_date: row.status_date ? new Date(row.status_date).toLocaleDateString("th-TH") : null,
      status_time: row.status_time ?? null,
      other_party_user_id: row.other_party_user_id,
      other_party_name: row.other_party_name,
      other_party_phone: row.other_party_phone,
      other_party_profile_image: row.other_party_profile_image,
      destination_address: row.destination_address ?? "ไม่มีข้อมูลที่อยู่",
      destination_lat: row.destination_lat ?? 0.0,
      destination_lon: row.destination_lon ?? 0.0,
      item_image: row.item_image ?? "",
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงรายการรับของ", error: (error instanceof Error ? error.message : String(error)) });
  } finally {
    if (connection) connection.release();
  }
});

// GET all users with addresses
router.get("/all-users-with-addresses", async (req, res) => {
  let connection: mysql.PoolConnection | undefined;
  try {
    connection = await conn.getConnection();

    // ดึง users ทั้งหมด
    const [users] = await connection.query<RowDataPacket[]>(`
      SELECT user_id, name, phone, profile_image
      FROM users
      ORDER BY name
    `);

    // ดึง addresses ของ users ทั้งหมด
    const [addresses] = await connection.query<RowDataPacket[]>(`
      SELECT address_id, user_id, address, latitude, longitude
      FROM address
    `);

    // map addresses ให้เข้ากับ user
    const result = users.map(u => ({
      user: {
        user_id: u.user_id,
        name: u.name,
        phone: u.phone,
        profile_image: u.profile_image,
      },
      addresses: addresses
        .filter(a => a.user_id === u.user_id)
        .map(a => ({
          address_id: a.address_id,
          user_id: a.user_id,
          address: a.address,
          latitude: a.latitude,
          longitude: a.longitude,
        })),
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงผู้ใช้พร้อมที่อยู่",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (connection) connection.release();
  }
});