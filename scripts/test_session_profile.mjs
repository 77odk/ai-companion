// 当前角色资料解析纯逻辑自测（S1-2，npm test 入口）
// 断言逻辑在 src/lib/sessionProfile.test.ts（Node 原生类型剥离可跑），
// 这里只负责导入触发执行；失败时该文件会 throw，node --test 即报红。
import '../src/lib/sessionProfile.test.ts'
