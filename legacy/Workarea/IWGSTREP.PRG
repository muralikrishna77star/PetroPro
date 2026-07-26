
set procedure to
set safe off
set echo off
set talk off
indate=date()
CLOSE ALL
prnsplchar=.T.
define window dlg from 18,40 to 20,66 double
activate window dlg
@ 0,1 say "ENTER DATE :" get indate
read
deactivate window dlg

mbill=substr(cmonth(indate),1,3)+"Bil"+SUBSTR(ALLTRIM(STR(YEAR(indate))),3,2)
mstock=substr(cmonth(indate),1,3)+"Stk"+SUBSTR(ALLTRIM(STR(YEAR(indate))),3,2)

wait window mstock nowait
*on error do irerr
do usedbf with mbill, 1
do temprep
  select distinct a.icode, b.idesc, a.sales, c.group_code,;
  a.ostock, a.cstock, a.sdate;
  from &mstock a, item b, group c, &mbill d;
  where b.icode = a.icode;
  .and. c.group_code = b.group_code;
  .and. d.icode = a.icode;
  having a.sdate = indate;
  order by c.group_code, a.icode;
  into table rep1.dbf

select icode, sgst_per, cgst_per, igst_per, ;
sum(amt), sum(sgst_amt) as sum_sgst, ;
sum(cgst_amt) as sum_cgst, sum(igst_amt) as sum_igst ;
from temprep ;
group by icode,sgst_per, cgst_per, igst_per ;
 having bill_date=indate ;
  into table rep2.dbf

select rep1.group_code, rep1.icode, rep1.idesc, rep1.sales, rep2.sum_amt,;
  rep2.sum_sgst,rep2.sum_cgst, rep2.sum_igst, rep2.sgst_per, rep2.cgst_per, rep2.igst_per,;
  rep1.ostock, rep1.cstock, rep1.sdate;
  from rep1, rep2;
  where rep2.icode = rep1.icode;
  into table iwr.dbf
browse

do usedbf with "iwr", 1
x=repcon()
if x=1
  report form iwr11 to printer
else
  define window output from 2,0 to 24,79 panel title 'ITEMWISE SALES REPORT' ;
  footer "Press F5 Key to Print" close float grow shadow zoom

  report form iwr11 to reports.scx
  ON KEY LABEL F5 REPORT FORM iwr11 TO PRINTER
  modi file reports.scx noedit window output
  ON KEY LABEL F5 
endif
close all
erase rep1.dbf
erase rep2.dbf
erase iwr.dbf
erase temprep.dbf
clear
on error
return to mainmenu



procedure temprep
close all
*on error do irerr
*do usedbf with mbill, 1
*copy struct to temprep.dbf
select * from &mbill into table temprep where 1=2 
*set stat on 
*wait

close all
do usedbf with "temprep", 1
append from &mbill for bill_date=indate
*browse
*: EOF: ITEMREP.PRG

procedure irerr
wait "No Bills Found on the Specified Date" window nowait
clea
set talk off
on error
return to mainmenu


