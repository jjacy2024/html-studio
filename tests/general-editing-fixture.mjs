export const generalEditingHTML=()=>`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial;background:#fff;color:#222}.row{display:flex!important;gap:28px;align-items:flex-start;padding:12px}.row>.card{position:relative!important;width:150px;height:70px;background:#eee;flex-shrink:0}.row>.card b{color:rgb(190,20,40);font-weight:700}
#free{position:relative;width:900px;height:260px;margin-top:24px}#free>.item{position:absolute;width:100px;height:50px;color:rgb(20,40,190)!important;background:#ddd}#a{left:10px;top:10px}#b{left:180px;top:40px}#c{left:400px;top:80px}
#styled{color:#111!important;font-size:20px!important}#rich{font-size:22px}#rich span{color:red}#rich b{font-weight:bold}#locked-parent{padding:20px}
</style></head><body><h1 id="styled">测试标题</h1><p id="rich">你好<span>红色</span><b>加粗</b><a href="#free">链接</a></p><p id="single"><b>唯一片段</b></p>
<div class="row" id="flow"><div class="card" id="card1"><b>卡片一</b></div><div class="card" id="card2">卡片二</div><div class="card" id="card3">卡片三</div></div>
<div id="free"><div class="item" id="a">A</div><div class="item" id="b">B</div><div class="item" id="c">C</div></div>
<div id="locked-parent"><p id="locked-child" data-hs-locked="true">锁定</p></div>
<table id="data"><tr><th>月份</th><th>金额</th></tr><tr><td>四月</td><td>100</td></tr></table>
</body></html>`;
