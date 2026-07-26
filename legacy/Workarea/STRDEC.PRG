function strdec
parameter val
dec=(val-int(val))*100
if dec<10
decstr="0"+alltrim(str(dec))
else
decstr=alltrim(str(dec))
endif
num=int(val)
return alltrim(str(num))+"."+decstr
