set talk off
set echo off
@ 11,43 to 11,43 double
x=19
x1=10
y1=41
x2=12
y2=44
do while x>0
clear
@ x1,y1 to x2,y2 double
y1=y1-1
y2=y2+1
x=x-1
do cnt
enddo

c=2
do while c>0
clear
@ x1,y1 to x2,y2 double
x1=x1-1
y1=y1-1
x2=x2+1
y2=y2+1
c=c-1
do cnt
enddo
clear
@ 9,21 to 14,64 double
clear
do cnt
@ 8,20 to 15,65 double
do cnt
clear
 
procedure cnt
cnt=1
do while cnt<5000
cnt=cnt+1
enddo
