function kuttiwin
parameter opcl
if opcl=1
define window kuttiwin from 10,35 to 12,45 panel color GR+/W
activate window kuttiwin
@ 0,1 say "Working" color R+*
else
deactivate window kuttiwin
endif
