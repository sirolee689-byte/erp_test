// 引入配置和驱动
require('dotenv').config();
const sql = require('mssql');

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER, 
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT),
    options: {
        encrypt: false, // 如果是本地 SQL Server，通常设为 false
        trustServerCertificate: true // 信任服务器证书
    }
};

async function testConnection() {
    try {
        console.log('正在尝试连接 SQL Server...');
        // 1. 建立连接
        let pool = await sql.connect(config);
        console.log('✅ 连接成功！');

        // 2. 执行一个简单的 SQL 查询：查询系统当前时间
        let result = await pool.request().query('SELECT GETDATE() as currentTime');
        
        console.log('📊 数据库返回测试数据：', result.recordset[0].currentTime);
        console.log('🚀 恭喜！你的后端已经可以和 SQL Server 通信了。');

        // 3. 关闭连接
        await sql.close();
    } catch (err) {
        console.error('❌ 连接失败，错误原因：', err.message);
    }
}

testConnection();