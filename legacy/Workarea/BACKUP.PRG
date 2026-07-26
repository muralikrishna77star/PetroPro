set talk off
set echo off
set procedure to
close all
CHOICE=0
fdrive="D:"

define window msg from 10,10 to 17,63 double float
activate window msg
@ 0,10 say "DATABASE BACKUP"
@ 1,0 to 1,46 
@ 2,1 say "FLASH DISK & PRESS OK TO CONTINUE"
@ 2,1 SAY "Enter Flash Disk Drive Letter [C:, D:, E: etc]:"get fdrive
read
@ 4,10 get choice function '*h \<OK;\<CANCEL' size 1,8,2
read cycle
clea

filname="BK"+substr(dtoc(date()),1,2)+substr(dtoc(date()),4,2)+substr(dtoc(date()),9,2)+".ZIP"
if choice=1
	*on error do errorproc
	
	dt="\petbill\workarea\backup\BK"+substr(dtoc(date()),1,2)+substr(dtoc(date()),4,2)+substr(dtoc(date()),9,2)+".ZIP"
	
	!del \petbill\workarea\backup\*.zip
	
	!pkzip &dt \petbill\workarea\*.dbf

	!copy \petbill\workarea\backup\*.zip &fdrive
	
	wait window "Backup created successfully in "+alltrim(fdrive)+"\"+alltrim(filname)
	activate screen
	do top
	activate window formain
	deactivate window msg
	release all
else
	release all
	return to mainmenu
endif

procedure errorproc
on error
activate screen
do top
activate window formain
deactivate window msg
release all
wait window "Error Copying Files - PATH ERROR"
return to mainmenu