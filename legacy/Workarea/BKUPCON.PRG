function bkupcon
choice=0
define window msg from 9,20 to 18,60 double float
activate window msg
@ 0,13 say "CONFIRMATION"
@ 1,0 to 1,40 
@ 2,4 say "These Operation will Overwrite Your Data"
@ 3,7 say "Are You Sure To Continue?"
@ 6,10 get choice function '*h \<Yes;\<No' size 1,8,2
read cycle
deactivate window msg
return choice