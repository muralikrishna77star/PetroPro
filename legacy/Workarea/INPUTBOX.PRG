function inputbox
parameter detstr
define window ib from 10,25 to 12,65 
activate window ib
outstr=space(8)
@ 0,2 say detstr
@ 0,22 get outstr 
read
deactivate window ib
return outstr