(() => {
  const active = document.body.dataset.repairState === 'active'
  const activePanel = document.getElementById('repair-active')
  const pendingPanel = document.getElementById('repair-pending')
  if (activePanel) activePanel.hidden = !active
  if (pendingPanel) pendingPanel.hidden = active
  const button = document.getElementById('copy-repair-command')
  const command = document.getElementById('repair-command')
  const status = document.getElementById('copy-status')
  if (!active || !button || !command || !status) return
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.textContent.trim())
      status.textContent = '已复制。请在交互式终端中粘贴执行，并核对修复计划后再输入确认语。'
    } catch {
      status.textContent = '浏览器未允许复制；请手动选择上方完整命令。'
    }
  })
})()
