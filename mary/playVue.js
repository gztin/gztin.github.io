const vm = Vue.createApp({
	data () {
		return {
			totalBet : 23,
			runTime : 0,
			gameResult : 0,
			highLight : 0,
			move : 0,
			sec : 50,
			isPlay : false,
			bet:[
				{name:'LEMOM',point:1.1},
				{name:'STAR',point:1.1},
				{name:'BAR',point:1.1},
				{name:'RING',point:1.1},
				{name:'ORANGE',point:1.1},
				{name:'SEVEN',point:1.1}
			]
		};
    },
    create(){
        
    },
	computed:{
		
	},
	methods:{
		
		playGame(){
			// 計算小瑪莉走幾步
			this.gameResult = Math.floor(Math.random()*24+48);


		}
	}
  }).mount('#app');

