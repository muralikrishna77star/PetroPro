Procedure backup
fbill=substr(cmonth(dmax()),1,3)+"Bil"+SUBSTR(ALLTRIM(STR(YEAR(dmax()))),3,2)+".dbf"
fstock=substr(cmonth(dmax()),1,3)+"Stk"+SUBSTR(ALLTRIM(STR(YEAR(dmax()))),3,2)+".dbf"
fpurc="Purch"+SUBSTR(ALLTRIM(STR(YEAR(dmax()))),3,2)+".dbf"

dfbill="\petbill\workarea\backup\"+fbill
dfstock="\petbill\workarea\backup\"+fstock
dfpurc=".\backup\"+fpurc

close all

copy file item.dbf to \petbill\workarea\backup\item.dbf
copy file usertab.dbf to \petbill\workarea\backup\usertab.dbf
copy file &fstock.dbf to &dfstock
copy file &fbill.dbf to &dfbill
copy file members.dbf to \petbill\workarea\backup\members.dbf 
copy file customer.dbf to \petbill\workarea\backup\customer.dbf 
copy file veh_det.dbf to \petbill\workarea\backup\veh_det.dbf
copy file group.dbf to \petbill\workarea\backup\group.dbf
copy file billno.dbf to \petbill\workarea\backup\billno.dbf
copy file datestat.dbf to \petbill\workarea\backup\datestat.dbf


