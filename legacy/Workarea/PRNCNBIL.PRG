
parameter billno, billstatus, retail
set currency to "Rs."
clear
close all
r=retail
set safe off
set talk off
define window groupw from 1,2 to 24,78 double float
activate window groupw
@ 1,0 to 1,76 
@ 0,25 say "Bill Details - Bill Cancellation"
bn=billno
cstatus=billstatus
tamt=0
*bdate=ctod("01/08/2000")
billtype=space(15)
do case
	case cstatus="C"
		billtype=" CASH BILL"
	case cstatus="R"
		billtype="CREDIT BILL"
	case cstatus="K"
		billtype="KEROSENE BILL"
endcase
@ 3,39  say "Bill Status   : "+billtype 
x=14
mbill=substr(cmonth(dmax()),1,3)+"Bil"+SUBSTR(ALLTRIM(STR(YEAR(dmax()))),3,2)
select a
use &mbill
select b
use item
index on icode to idxcode
select c
use USERTAB

select a
locate for bill_no=bn .and. status=cstatus
vehno=veh_no
select c
index on USER_ID to indcinint
locate for USER_ID=a->USER_ID
cname=name
select a
@ 3,3 say " Bill No.     :  "+alltrim(str(bn))
@ 5,3 say " Bill Date    : "
@ 5,20 say dtoc(bill_date)
@ 7,3 say " Cashier Name :  "+alltrim(cname)
@ 5,38 say " VEHICLE NO.   : "+alltrim(vehno)


@ 11,3 to 21,70 double
@ 12,5 say "Item Code   Description          Rate        Qty          Amount" color w+
@ 13,4 to 13,69

do while bill_no=bn .and. status=cstatus
	select b
	locate for icode=a->icode
	@ x,8 say icode
	@ x,17 say alltrim(b->idesc)
	if retail=1
		@ x,37 say b->ipricer picture '999.99'
	else
		@ x,37 say b->ipricew picture '999.99'
	endif
	@ x,48 say a->qty picture '9999.9'
	@ x,61 say a->amt picture '99999.99'
	tamt=tamt+(a->amt)
	if x<20
		x=x+1
	endif
	select a
	skip
enddo

if r=0
	@ 9,4 say "Sales Type   :  WholeSale"
else
	@ 9,4 say "Sales Type   :  Retail"
endif

if cstatus="R"
	@ 7,38 say " Customer Name : "+alltrim(cust_code)
	@ 9,38 say " Order No.     : "+alltrim(str(ono))
endif
x=19
@ x,4 say "컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴컴"
@ x+1,5 say " Total Amount :                    "
@ x+1,56 say tamt function "$"




