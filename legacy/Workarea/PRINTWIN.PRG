function printwin
parameter opcl
if opcl=1
	define window printwin from 10,30 to 14,50 double color GR+/B
	activate window printwin
	@ 1,5 say "PRINTING" color R+*
else
	deactivate window printwin
endif
