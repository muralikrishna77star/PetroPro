choice=0
define window msg from 10,20 to 17,60 double float
activate window msg
@ 0,13 say "MONTHLY BACKUP"
@ 1,0 to 1,40 
@ 2,7 say "INSERT FLOPPY DISK & PRESS OK TO CONTINUE"
@ 4,10 get choice function '*h \<OK;\<CANCEL' size 1,8,2
read cycle
if choice=1

deactivate window msg
