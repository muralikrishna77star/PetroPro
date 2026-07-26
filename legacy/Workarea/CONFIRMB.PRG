function confirmb
choice=0
define window msg from 10,20 to 17,60 double float
activate window msg
@ 0,13 say "CONFIRMATION"
@ 1,0 to 1,40 
@ 2,7 say "Are You Sure To Cancel Bill ?"
@ 4,10 get choice function '*h \<Yes;\<No' size 1,8,2
read cycle
deactivate window msg
return choice