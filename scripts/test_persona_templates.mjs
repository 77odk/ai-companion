// 角色模板数据自测（npm test 入口）
// 直接把断言逻辑放进 src/lib/personaTemplates.test.ts（Node 原生类型剥离可跑），
// 这里只负责导入触发执行；失败时该文件会 throw，node --test 即报红。
import '../src/lib/personaTemplates.test.ts'
