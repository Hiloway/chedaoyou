import { testConnection } from './db.ts';

testConnection().then(success => {
  if (success) {
    console.log('数据库连接测试通过');
    process.exit(0);
  } else {
    console.log('数据库连接测试失败');
    process.exit(1);
  }
});
