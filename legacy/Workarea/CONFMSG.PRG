function confmsg
parameter msg, title
on key label esc
define window msg from 10,20 to 17,60 double float
activate window msg
@ 0,0 say padc(title,40," ")
@ 1,0 to 1,40 
@ 2,1 say msg
@ 4,0 to 4,40
mchoice=2
*@ 5,10 GET mchoice FUNCTION '*H OK; Cancel' DEFAULT 2 size 1,8,2
*READ
@ 5,10 get mchoice function '*h \<Yes;\<No' DEFAULT 2 size 1,8,2 
read cycle
clear read
deactivate window msg
return mchoice