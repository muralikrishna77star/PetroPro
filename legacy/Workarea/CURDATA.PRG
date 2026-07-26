close all
on error do transerr

wait "Transfering Entire Data" window nowait
cdate=dmax()

mbill="e:\petbill\workarea\"+substr(cmonth(cdate),1,3)+"Bil"+SUBSTR(ALLTRIM(STR(YEAR(CDATE))),3,2)+".dbf"
mstk="e:\petbill\workarea\"+substr(cmonth(cdate),1,3)+"stk"+SUBSTR(ALLTRIM(STR(YEAR(CDATE))),3,2)+".dbf"
!copy &mbill
!copy &mstk
wait window "Data Transferred Succesfully"
activate screen
do top
activate window formain
release all


procedure transerr
on error
wait Window "Unable To Transfer Data - Sharing Violation"
return to mainmenu

