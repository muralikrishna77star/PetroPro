function splstr
parameter convnum
endif
intpart=int(convnum)
dcpart=int((convnum-int(convnum))*100)
if dcpart<0
dcpart=-1*dcpart
endif
retstr=alltrim(str(intpart))+"."+padl(alltrim(str(dcpart)),2,'0')
return retstr