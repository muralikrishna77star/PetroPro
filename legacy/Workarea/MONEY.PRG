function money
parameter innums
set talk off
set echo off
wstr=space(100)

do case
case innums>0 and innums<10
wstr=onenum(innums)

case innums>=10 and innums<100
if innums<20
wstr=twonum(innums)
else
wstr=mot(val(substr(alltrim(str(innums)),1,1)));
+" "+onenum(val(substr(alltrim(str(innums)),2,1)))
endif


case innums>=100 and innums<1000
if(mod(innums,100)!=0) 
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+;
" hundred "+money(val(substr(alltrim(str(innums)),2,2)))
else
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+" hundred"
endif

case innums>=1000 and innums<10000
if(mod(innums,1000)!=0) 
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+;
" Thousand "+money(val(substr(alltrim(str(innums)),2,3)))
else
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+" Thousand"
endif

case innums>=10000 and innums<100000
if(mod(innums,10000)!=0) 
wstr=money(val(substr(alltrim(str(innums)),1,2)))+;
" Thousand "+money(val(substr(alltrim(str(innums)),3,4)))
else
wstr=money(val(substr(alltrim(str(innums)),1,2)))+" Thousand"
endif

case innums>=100000 and innums<1000000
if(mod(innums,100000)!=0) 
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+;
" Lakh "+money(val(substr(alltrim(str(innums)),2,5)))
else
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+" Lakh"
endif

case innums>=1000000 and innums<10000000
if(mod(innums,1000000)!=0) 
wstr=money(val(substr(alltrim(str(innums)),1,2)))+;
" Lakh "+money(val(substr(alltrim(str(innums)),3,5)))
else
wstr=money(val(substr(alltrim(str(innums)),1,2)))+" Lakh"
endif

case innums>=10000000 and innums<100000000
if(mod(innums,10000000)!=0) 
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+;
" Crore "+money(val(substr(alltrim(str(innums)),2,7)))
else
wstr=onenum(val(substr(alltrim(str(innums)),1,1)))+" Crore"
endif

case innums>=100000000 and innums<1000000000
if(mod(innums,100000000)!=0) 
wstr=money(val(substr(alltrim(str(innums)),1,2)))+;
" Crore "+money(val(substr(alltrim(str(innums)),3,7)))
else
wstr=money(val(substr(alltrim(str(innums)),1,2)))+" Crore"
endif

case innums=1000000000
wstr="Hundred Crore"
endcase 

return alltrim(wstr)


function onenum
parameter innum
word=space(10)
do case 
case innum=1
word="One"
case innum=2
word="Two"
case innum=3
word="Three"
case innum=4
word="Four"
case innum=5
word="Five"
case innum=6
word="Six"
case innum=7
word="Seven"
case innum=8
word="Eight"
case innum=9
word="Nine"
endcase
return word


function twonum
parameter innum
word=space(10)
do case 
case innum=10
word="Ten"
case innum=11
word="Eleven"
case innum=12
word="Twelve"
case innum=13
word="Thirteen"
case innum=14
word="Fourteen"
case innum=15
word="Fifteen"
case innum=16
word="Sixteen"
case innum=17
word="Seventeen"
case innum=18
word="Eighteen"
case innum=19
word="Nineteen"
endcase
return alltrim(word)


function mot
parameter innum
do case
case innum=2
word="Twenty"
case innum=3
word="Thirty"
case innum=4
word="Fourty"
case innum=5
word="Fifty"
case innum=6
word="Sixty"
case innum=7
word="Seventy"
case innum=8
word="Eighty"
case innum=9
word="Ninety"
endcase
return word








