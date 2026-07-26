function ascofbin
parameter strbin
x=len(alltrim(strbin))
y=0
res=0
do while y<x
	res=res+(val(substr(strbin,y+1,1))*2^y)
	y=y+1
enddo
return res
