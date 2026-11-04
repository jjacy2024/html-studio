// Copyable onboarding instructions contain local paths, never bearer tokens.
export function agentConnectionPrompt(client,setup){
  const names={codex:'Codex',workbuddy:'WorkBuddy',qwen:'千问办公',doubao:'豆包工作'};
  const lines=[`请帮我把本机的「html全能编辑器」连接到 ${names[client]||'当前 Agent'}，完成配置和只读连接验证。`,
    '我已授权你添加此 MCP 服务。请实际完成配置，不要只回复操作教程；先备份，保留其他配置和已有服务，不要改工程内容。',
    '必须在我这台电脑的本地执行环境操作；如果你无法运行本机命令或修改本客户端设置，请明确说明，并只告诉我还需要手动完成的步骤。'];
  if(client==='codex')lines.push('优先运行编辑器自带的配置助手（以下为进程参数，不要把路径当作脚本代码）：',JSON.stringify({command:setup.command,args:[setup.args[0],'setup-codex',...setup.args.slice(2)]},null,2),'助手会备份并合并 html_studio 配置。若报告配置冲突，请先检查冲突，不要强制覆盖。');
  lines.push('本机 STDIO 连接配置：',JSON.stringify({mcpServers:{html_studio:{command:setup.command,args:setup.args}}},null,2));
  if(client==='doubao')lines.push('如果此版本只支持本机 HTTP 连接器：服务器地址为 '+setup.url+'；从本机文件 '+setup.settingsFile+' 读取 httpToken，仅在配置中设 Authorization: Bearer <httpToken>，不要在回复、日志或截图中输出凭据。若本客户端只支持云端执行，请说明当前本地连接不适用。');
  if(client!=='codex')lines.push('请根据你当前客户端真实支持的配置入口或配置文件合并 html_studio。不要猜测配置文件路径；无法确认时使用客户端的 MCP / 连接器导入入口。');
  lines.push('完成后验证能发现 html_studio 工具，再调用 studio_sessions。只有实际收到工具响应才能报告连接成功；写入配置本身不算连接成功。',
    '如需新建对话、重新加载 MCP 或重启客户端，请明确告诉我。不要自动关闭应用或丢弃未保存内容。',
    '如工程未授权，提示我回到编辑器点击「允许访问当前工程」。已授权时只读取工程名称、页数和图表列表；不要修改数据、绑定图表、切换工程或保存文件。多个工程时先让我选择。');
  return lines.join('\n\n');
}
