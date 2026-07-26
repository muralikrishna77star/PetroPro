function strdec3
parameter val
rdd=(val-int(val))*1000
do case 
case rdd<10
return alltrim(str(int(val)))+".00"+substr(alltrim(str(rdd)),1,2)
case rdd<100
return alltrim(str(int(val)))+".0"+substr(alltrim(str(rdd)),1,2)
otherwise
return alltrim(str(int(val)))+"."+substr(alltrim(str(rdd)),1,2)
endcase

