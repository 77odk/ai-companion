// 「换个 TA」二选一弹窗（B2c-2）
// 两个选项都绝不删数据：①当前会话换人设（记忆保留）；②开新会话换 TA（旧会话完整留存，B3 侧边栏可再进）。
// 极端情况（无当前会话）由 App/RolePicker 兜底走②，这里只管让用户选方向。

interface Props {
  /** 关闭弹窗（不换，什么都不动） */
  onClose: () => void
  /** 选好方向：current=当前会话换人设；new=开个新会话换 TA */
  onChoose: (mode: 'current' | 'new') => void
}

export default function SwitchRoleModal({ onClose, onChoose }: Props) {
  return (
    <div className="switch-role-overlay" role="dialog" aria-modal="true" aria-label="换个 TA">
      <div className="switch-role-card">
        <div className="switch-role-header">
          <h2 className="switch-role-title">想怎么换？</h2>
          <button type="button" className="switch-role-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="switch-role-options">
          <button type="button" className="switch-role-option" onClick={() => onChoose('current')}>
            <span className="switch-role-option-title">就换这个 TA 的性格</span>
            <span className="switch-role-option-desc">换性格：以前的聊天和记忆都还在</span>
          </button>

          <button type="button" className="switch-role-option" onClick={() => onChoose('new')}>
            <span className="switch-role-option-title">开个新会话，重新挑一个 TA</span>
            <span className="switch-role-option-desc">开新会话：现在这个 TA 会完整保留下来</span>
          </button>
        </div>
      </div>
    </div>
  )
}
